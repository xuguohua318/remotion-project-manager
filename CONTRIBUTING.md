# Contributing

感谢你帮助改进 Remotion Project Manager。

## 开发环境

- Windows 10/11 x64
- Node.js 22+
- npm

```powershell
npm install
npm test
npm run typecheck
npm start
```

## 提交 Pull Request

1. Fork 仓库并从 `main` 创建分支。
2. 保持修改范围清晰；修复缺陷时请增加回归测试。
3. 确保 `npm test` 和 `npm run typecheck` 通过。
4. 在 PR 中说明使用场景、验证方式和界面变化。

请勿提交真实工程素材、参数文件、访问令牌、本机日志、`node_modules` 或构建产物。

## 报告问题

Issue 中请包含：

- Windows、Node.js 和 npm 版本
- Remotion 版本
- 工程使用的包管理器
- 可复现步骤与任务日志
- 是否涉及中文或超长路径

粘贴日志前请删除用户名、绝对路径和其他敏感信息。
