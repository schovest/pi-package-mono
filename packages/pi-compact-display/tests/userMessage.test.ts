import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { UserMessageComponent, AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container, Spacer } from "@earendil-works/pi-tui";
import extension from '../src/index.ts';

vi.mock('fs');

describe('UserMessageComponent & Spacer Override', () => {
  const originalRebuild = UserMessageComponent.prototype.rebuild;
  const containerProto = Object.getPrototypeOf(AssistantMessageComponent.prototype) || Container.prototype;
  const originalAddChild = containerProto.addChild;
  const originalAddChildTui = Container.prototype.addChild;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    UserMessageComponent.prototype.rebuild = originalRebuild;
    containerProto.addChild = originalAddChild;
    Container.prototype.addChild = originalAddChildTui;
  });

  it('should remove vertical padding when noPadding is true', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      user: { noPadding: true }
    }));

    // Load the extension to apply the hook
    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn()
    };
    extension(mockPi as any);

    // Instantiate UserMessageComponent
    // The constructor calls rebuild() internally
    const component = new UserMessageComponent("Hello test prompt");

    // Retrieve the child Box container
    const box = (component as any).children[0];
    expect(box).toBeDefined();
    // paddingY (vertical padding) should be 0 instead of the default 1
    expect(box.paddingY).toBe(0);
    // paddingX (horizontal padding) should remain the default 1
    expect(box.paddingX).toBe(1);
  });

  it('should keep default vertical padding when noPadding is not specified', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

    // Load the extension to apply the hook
    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn()
    };
    extension(mockPi as any);

    // Instantiate UserMessageComponent
    const component = new UserMessageComponent("Hello test prompt");

    const box = (component as any).children[0];
    expect(box).toBeDefined();
    // paddingY should be 1
    expect(box.paddingY).toBe(1);
    expect(box.paddingX).toBe(1);
  });

  it('should silence adjacent Spacers when user.noPadding is true', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      user: { noPadding: true }
    }));

    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn()
    };
    extension(mockPi as any);

    const chatContainer = new Container();

    const spacerBefore = new Spacer(1);
    const userPrompt = new UserMessageComponent("My prompt");
    const spacerAfter = new Spacer(1);

    // Simulate adding spacer before prompt
    chatContainer.addChild(spacerBefore);
    expect(spacerBefore.lines).toBe(1); // not silenced yet since user prompt is not added yet

    // Simulate adding user prompt
    chatContainer.addChild(userPrompt);
    expect(spacerBefore.lines).toBe(0); // silenced now!

    // Simulate adding spacer after prompt
    chatContainer.addChild(spacerAfter);
    expect(spacerAfter.lines).toBe(0); // silenced immediately because last component was user prompt!
  });

  it('should silence the Spacer inside AssistantMessageComponent when following user prompt', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      user: { noPadding: true }
    }));

    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn()
    };
    extension(mockPi as any);

    const chatContainer = new Container();
    const userPrompt = new UserMessageComponent("My prompt");
    chatContainer.addChild(userPrompt);

    // Instantiate AssistantMessageComponent
    const assistantMessage = new AssistantMessageComponent({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello!' }
      ]
    });

    chatContainer.addChild(assistantMessage);

    // Let's verify that the Spacer inside assistantMessage.contentContainer is silenced
    const innerSpacer = (assistantMessage as any).contentContainer.children.find((c: any) => c && c.constructor && c.constructor.name === "Spacer") as Spacer | undefined;
    expect(innerSpacer).toBeDefined();
    expect(innerSpacer?.lines).toBe(0); // silenced!
  });

  it('should not silence Spacers when user.noPadding is false', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn()
    };
    extension(mockPi as any);

    const chatContainer = new Container();

    const spacerBefore = new Spacer(1);
    const userPrompt = new UserMessageComponent("My prompt");
    const spacerAfter = new Spacer(1);

    chatContainer.addChild(spacerBefore);
    chatContainer.addChild(userPrompt);
    chatContainer.addChild(spacerAfter);

    expect(spacerBefore.lines).toBe(1);
    expect(spacerAfter.lines).toBe(1);
  });
});
