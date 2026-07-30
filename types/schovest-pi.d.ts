/**
 * 桥接声明：将 @schovest/pi-* 命名空间映射到 @earendil-works/pi-*。
 *
 * 新扩展导入 @schovest/pi-*（发布名空间），但 monorepo 内通过
 * @earendil-works/pi-*（已安装为 devDependencies）提供类型。
 */
declare module "@schovest/pi-ai" {
	export * from "@earendil-works/pi-ai";
}

declare module "@schovest/pi-coding-agent" {
	export * from "@earendil-works/pi-coding-agent";
}

declare module "@schovest/pi-tui" {
	export * from "@earendil-works/pi-tui";
}
