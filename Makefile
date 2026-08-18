SHELL := /bin/bash

.PHONY: help setup browser-client extension electron native baseline extension-dev full-reconstructed all verify package clean

help:
	@echo "Boss投递开发工作区"
	@echo "  make setup              初始化隔离的 Python 验证环境"
	@echo "  make browser-client     用 Bun 构建并部署 TypeScript 恢复脚本"
	@echo "  make extension          构建 TypeScript/React Chrome 扩展"
	@echo "  make electron           测试并组装 Electron Main 安装生命周期"
	@echo "  make native             构建 Rust 语义重建 Native Host"
	@echo "  make baseline           组装当前签名基线交付"
	@echo "  make extension-dev      源码扩展 + 当前签名 Native Host"
	@echo "  make full-reconstructed 源码扩展 + Rust 重建 Native Host"
	@echo "  make all                生成全部三种构建档位"
	@echo "  make verify             验证源码、身份和构建产物"
	@echo "  make package            打包全部 marketplace 交付物"
	@echo "  make clean              清理 dist/、artifacts/ 和组件构建缓存"

setup:
	@./scripts/bootstrap.sh

browser-client:
	@cd components/codex-plugin/src/browser-client && bun install --frozen-lockfile && bun run build && bun run deploy

extension:
	@./scripts/build-extension.sh

electron:
	@./scripts/build-electron-app.sh

native:
	@./scripts/build-native-host.sh

baseline: browser-client electron
	@./scripts/assemble-marketplace.sh baseline

extension-dev: browser-client electron extension
	@./scripts/assemble-marketplace.sh extension-dev

full-reconstructed: browser-client electron extension native
	@./scripts/assemble-marketplace.sh full-reconstructed

all: baseline extension-dev full-reconstructed

verify:
	@./scripts/verify.sh

package: all verify
	@./scripts/package.sh

clean:
	@./scripts/clean.sh
