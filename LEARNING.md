# 从零重写 OpenVPM

这条分支没有父提交。`main` 留在 `/home/evan/projects/openvpm`，当作对照课本。这里只复现诊所主路径上的行为，一次一步。

## 学习契约

- 先在 `main` 读该步列出的文件，用自己的话写出这一步要保住的行为，再写代码。
- 只复现行为，不粘贴生产实现。技术栈保持一致：pnpm workspace、Next.js、tRPC、Drizzle、PostgreSQL。这样读懂的是这份仓库，而不是另一套系统。
- 一步一个可运行行为。不要自动提交。只有用户在当条消息里明确要求提交时才提交，提交说明写明对照了 `main` 上的哪些文件。
- 租户边界从第一张业务表就带上 `practiceId`。AI、迁移工具留到主路径走通之后。

## 迭代顺序

顺序跟诊所一天的数据流一致，也跟 `main` 上 `packages/db/schema/index.ts` 的依赖一致：诊所 → 人 → 客户 → 患者 → 预约 → 病历 → 账单。tRPC 路由的对应入口在 `apps/web/server/routers/_app.ts`。

1. **空壳能启动。** 对照 `package.json`、`pnpm-workspace.yaml`。最小 pnpm workspace，加一个能打开的 Next 页面。
2. **诊所和员工。** 对照 `packages/db/schema/common.ts`、`packages/db/schema/practices.ts`、`packages/db/schema/users.ts`，以及 `docker/docker-compose.yml` 里的 Postgres。只建 practice、user、membership。先不做订阅、税、提醒开关。
3. **登录。** 对照 `packages/db/schema/auth.ts` 和 `apps/web/server/routers/auth.ts`。邮箱密码、数据库会话、请求里能拿到当前 practice。先不做 TOTP、邀请、找回密码。
4. **客户和患者。** 对照 `packages/db/schema/clients.ts`、`packages/db/schema/patients.ts`，以及 `clients` / `patients` router。一个客户名下多只宠物，列表和详情可读写。
5. **预约。** 对照 `packages/db/schema/scheduling.ts` 和 appointments router。把一只患者约到某位医生的某个时间段。
6. **就诊记录。** 对照 `packages/db/schema/clinical.ts`、encounters 与 records router。一次预约写出一条 SOAP。
7. **账单。** 对照 `packages/db/schema/billing.ts` 和 billing router。这次就诊产生一张草稿发票和一条收费明细。
8. **之后再单独立项。** 库存、白板、门户、通信、webhook、`/api/v1`、RLS。每一项仍是一次只学一个行为。
9. **发出一条已同意的短信。** 对照 `apps/web/server/routers/communications.ts`、`apps/web/lib/sms.ts`、`apps/web/lib/messaging/`。客户有电话且同意、诊所不在静默时段时，记录先写入 pending，再变成 sent，并记下 provider 返回的消息 id。provider 层与 main 同构：`MESSAGING_PROVIDER` 显式指定，否则用配置了 `TELNYX_API_KEY` 的 Telnyx，都没有时落到 console 兜底（打日志不真发）。邮件呼出仍停在 pending。
10. **为一张已发送的发票发起收款。** 对照 billing router 的 `createCardPaymentCheckout`，走 Stripe Checkout 预授权（manual capture）。没有 `STRIPE_SECRET_KEY` 时提示尚未配置。把发票回写为已支付是 main 上 Stripe webhook（checkout.session.completed）的职责，留到 webhook 那一步再补。
