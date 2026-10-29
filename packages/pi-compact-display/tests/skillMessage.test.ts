import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { UserMessageComponent, AssistantMessageComponent, SkillInvocationMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer } from "@earendil-works/pi-tui";
import extension from '../src/index.ts';

vi.mock('fs');

describe('SkillInvocationMessageComponent & Spacer Override', () => {
  const originalUpdateDisplay = (SkillInvocationMessageComponent.prototype as any).updateDisplay;
  const containerProto = Object.getPrototypeOf(UserMessageComponent.prototype) || Container.prototype;
  const originalAddChild = containerProto.addChild;
  const originalAddChildTui = Container.prototype.addChild;

  const skillBlock = {
    name: 'test-skill',
    location: '/test',
    content: 'test content',
    userMessage: undefined,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    initTheme("dark"); // グローバル theme を初期化 (失敗時は dark にフォールバック)
  });

  afterEach(() => {
    // プロトタイプパッチを元に戻す (テスト間のリーク防止)
    (SkillInvocationMessageComponent.prototype as any).updateDisplay = originalUpdateDisplay;
    containerProto.addChild = originalAddChild;
    Container.prototype.addChild = originalAddChildTui;
  });

  const loadExtension = (configJson: any) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
    const mockPi = {
      on: vi.fn(),
      registerToolRenderer: vi.fn()
    };
    extension(mockPi as any);
  };

  it('should remove vertical padding when skill.noPadding is true', () => {
    loadExtension({ skill: { noPadding: true } });

    const component = new SkillInvocationMessageComponent(skillBlock);

    // paddingY (vertical padding) should be 0 instead of the default 1
    expect((component as any).paddingY).toBe(0);
    // paddingX (horizontal padding) should remain the default 1
    expect((component as any).paddingX).toBe(1);
  });

  it('should keep default vertical padding when skill.noPadding is not specified', () => {
    loadExtension({});

    const component = new SkillInvocationMessageComponent(skillBlock);

    // paddingY should remain the default 1
    expect((component as any).paddingY).toBe(1);
  });

  it('should silence adjacent Spacers when skill.noPadding is true', () => {
    loadExtension({ skill: { noPadding: true } });

    const chatContainer = new Container();

    const spacerBefore = new Spacer(1);
    const skillComp = new SkillInvocationMessageComponent(skillBlock);
    const spacerAfter = new Spacer(1);

    // Simulate adding spacer before skill component
    chatContainer.addChild(spacerBefore);
    expect((spacerBefore as any).lines).toBe(1); // not silenced yet since skill is not added yet

    // Simulate adding skill component
    chatContainer.addChild(skillComp);
    expect((spacerBefore as any).lines).toBe(0); // silenced now!

    // Simulate adding spacer after skill component
    chatContainer.addChild(spacerAfter);
    expect((spacerAfter as any).lines).toBe(0); // silenced immediately because last component was skill!
  });

  it('should silence Spacer between skill and user when both noPadding are true', () => {
    loadExtension({ user: { noPadding: true }, skill: { noPadding: true } });

    const chatContainer = new Container();

    const skillComp = new SkillInvocationMessageComponent(skillBlock);
    const spacerBetween = new Spacer(1);
    const userPrompt = new UserMessageComponent("My prompt");

    chatContainer.addChild(skillComp);
    chatContainer.addChild(spacerBetween);
    chatContainer.addChild(userPrompt);

    // The Spacer between skill and user message is silenced
    expect((spacerBetween as any).lines).toBe(0);
  });

  it('should silence the Spacer inside AssistantMessageComponent when following skill invocation', () => {
    loadExtension({ skill: { noPadding: true } });

    const chatContainer = new Container();
    const skillComp = new SkillInvocationMessageComponent(skillBlock);
    chatContainer.addChild(skillComp);

    // AssistantMessageComponent のコンストラクタは contentContainer に先頭 Spacer(1) を追加する。
    // この時点では chatContainer.addChild(assistant) がまだ実行されておらず、共有状態
    // lastSignificantComponentType が "skill" のままなので、内部 Spacer が抑制される。
    const assistantMessage = new AssistantMessageComponent({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello!' }
      ]
    } as any);

    chatContainer.addChild(assistantMessage);

    // assistantMessage.contentContainer 内の Spacer が抑制されていることを確認
    const innerSpacer = (assistantMessage as any).contentContainer.children.find((c: any) => c && c.constructor && c.constructor.name === "Spacer") as Spacer | undefined;
    expect(innerSpacer).toBeDefined();
    expect((innerSpacer as any)?.lines).toBe(0); // silenced!
  });
});
