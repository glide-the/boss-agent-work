SHELL := /bin/bash

.PHONY: help setup extension native baseline extension-dev full-reconstructed all verify package clean

help:
	@echo "Boss投递开发工作区"
	@echo "  make setup              初始化隔离的 Python 验证环境"
	@echo "  make extension          构建 TypeScript/React Chrome 扩展"
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

extension:
	@./scripts/build-extension.sh

native:
	@./scripts/build-native-host.sh

baseline:
	@./scripts/assemble-marketplace.sh baseline

extension-dev: extension
	@./scripts/assemble-marketplace.sh extension-dev

full-reconstructed: extension native
	@./scripts/assemble-marketplace.sh full-reconstructed

all: baseline extension-dev full-reconstructed

verify:
	@./scripts/verify.sh

package: all verify
	@./scripts/package.sh

clean:
	@./scripts/clean.sh
