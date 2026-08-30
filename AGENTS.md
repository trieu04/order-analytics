# AGENTS.md

## Mục tiêu

Đây là service độc lập thu thập buy order Minecraft. Không phụ thuộc JsMacros
hoặc Auction House control plane.

```text
Mineflayer → /order → Orders (Page 1) → parser → PostgreSQL → API/Grafana
```

## Stack và cấu trúc

- Node.js 22+, CommonJS; Mineflayer; Express 5; Drizzle ORM; `pg`; PostgreSQL 17.
- UI HTML + AlpineJS 3 + Pico.css 2, không có build step.
- `src/index.js`: API composition root và lifecycle.
- `src/api/analytic/`: dashboard HTML và analytics/scan router.
- `src/api/account/`: account HTML, validation và router.
- `src/api/setting/`: setting HTML, validation và router.
- `src/collector/`: collector, order parser và observation client.
- `src/shared/database/`: Drizzle setup, schema, repository và raw query cô lập.
- `src/shared/config.js`, `src/shared/logger.js`: config và logger dùng chung.
- `test/`: unit tests không cần Minecraft server.

## Quy tắc nghiệp vụ

- Chỉ quét title `Orders (Page 1)`; không chuyển page 2.
- Mọi scan đi qua queue tuần tự; không gửi hai `/order` đồng thời.
- Chỉ đọc slot trước `window.inventoryStart`.
- `remaining` luôn bằng `total - delivered`; database phải giữ invariant.
- Lưu order thô và summary trong cùng transaction.
- Không suy diễn order rời trang 1 là đã fill.
- Chỉ tính fill velocity khi price bucket đủ an toàn để so sánh. Thay đổi điều
  kiện này cần test và giải thích nguy cơ false positive.
- API không authentication theo yêu cầu. Compose phải bind API/PostgreSQL vào
  `127.0.0.1` mặc định.

## Cấu hình

- Credentials, Minecraft host/port/version, database URL và API port là static env.
- Item list, scheduler, interval và settle time là dynamic PostgreSQL config.
- Environment dynamic values chỉ seed `app_config` lần đầu, không ghi đè config operator.
- Mọi `PUT /api/settings` phải qua `normalizeSetting`.
- Server phải persist thành công trước khi áp dụng config mới trong memory.

## Mineflayer safety

- Đăng ký `windowOpen` listener trước khi gửi command.
- Mọi listener chờ window phải có timeout và được gỡ khi timeout.
- Đóng window trong `finally`.
- Bot có thể disconnect trước khi plugin API hoàn chỉnh; kiểm tra method khi shutdown.
- Không log token, cache hoặc credentials.

## Database safety

- Snapshot và entries nằm trong cùng transaction.
- Bootstrap/migration phải idempotent và tương thích database đang có.
- Không drop/xóa dữ liệu nếu không có yêu cầu rõ ràng.
- Luôn parameterize SQL; giữ index `(item_id, observed_at DESC)`.

## UI

- Giữ HTML + AlpineJS + Pico.css; không thêm bundler/framework khác.
- UI chỉ gọi REST, không chứa database logic.
- Server-side validation là chuẩn; HTML validation chỉ hỗ trợ UX.
- Giữ giao diện usable trên desktop và mobile.

## Kiểm thử bắt buộc

```bash
npm test
node --check src/index.js
node --check src/collector/index.js
node --check src/collector/main.js
docker compose config
```

Khi sửa Docker/dependency:

```bash
npm audit --omit=dev
docker compose --profile collector build collector
```

Khi sửa parser, thêm lore fixture hợp lệ và malformed vào
`test/parser.test.js`. Test không được yêu cầu account/server thật.

## Code style

- Dùng `"use strict"`, CommonJS và semicolon.
- Parser/validator nên là hàm thuần.
- Không thêm dependency nếu code nhỏ hoặc Node.js đã giải quyết được.
- Input error dùng `statusCode: 400`; bot unavailable dùng 503.
- Log ngắn với prefix `[api]`, `[scan]`, `[minecraft]`, `[scheduler]`.

## Ngoài phạm vi nếu chưa được yêu cầu

- Không tự đặt order, click giao hàng hoặc thay đổi state trong game.
- Không public port, thêm auth/reverse proxy.
- Không mở rộng sang sell order/Auction House hay nhiều page.
- Không commit `.env`, `profiles/`, token, database dump hoặc auth volume.
