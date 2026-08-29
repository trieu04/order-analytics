# Minecraft Order Analytics

Collector nghiên cứu thị trường Minecraft chạy độc lập bằng Mineflayer. Bot
thực thi `/order <item>`, đọc duy nhất `Orders (Page 1)` và lưu lịch sử giá,
khối lượng order vào PostgreSQL để truy vấn bằng Grafana hoặc REST API.

```text
Minecraft server → Mineflayer collector → PostgreSQL → Grafana
                         ↑
                  Config UI / REST
```

## Chức năng

- Đăng nhập bằng Microsoft device code hoặc offline authentication.
- Quét tuần tự nhiều item, không mở đồng thời nhiều container.
- Parse `price`, `delivered`, `total` và `remaining` từ lore.
- Tổng hợp best price, best-price volume, total volume, weighted price và fill ratio.
- Ước lượng queue tại giá cao hơn và fill velocity khi dữ liệu đủ an toàn.
- UI cấu hình động bằng HTML, AlpineJS và Pico.css, không có build step.
- Cấu hình vận hành lưu trong PostgreSQL và áp dụng không cần restart.
- Docker Compose cho PostgreSQL và collector.

## Yêu cầu

- Node.js 22+ nếu chạy trực tiếp.
- Docker và Docker Compose nếu chạy bằng container.
- Minecraft account có thể kết nối tới server mục tiêu.
- Server cung cấp `/order` và GUI `Orders (Page 1)` có lore tương thích.

## Quick start bằng Docker

```bash
cp .env.example .env
```

Chỉnh tối thiểu:

```env
MC_HOST=play.example.com
MC_PORT=25565
MC_USERNAME=email@example.com
MC_AUTH=microsoft
MC_VERSION=false
SERVICE_PORT_API=3010
SERVICE_PORT_PG=55432
POSTGRES_DB=order_analytics
POSTGRES_USER=order_analytics
POSTGRES_PASSWORD=change-me
SERVICE_DATABASE_URL=postgres://order_analytics:change-me@postgres:5432/order_analytics
ITEMS=[{"id":"minecraft:redstone_block","query":"redstone block"}]
```

Khởi động:

```bash
docker compose --profile collector up -d --build
docker compose logs -f collector
```

Lần đăng nhập Microsoft đầu tiên, log sẽ hiện URL và device code. Token được
giữ trong volume `auth-profiles`. Mở UI tại
[http://localhost:3010](http://localhost:3010).

## Chạy trực tiếp

```bash
docker compose up -d postgres
npm install
set -a
source .env
set +a
npm start
```

Dùng `npm run dev` để tự khởi động lại khi sửa source.

## Cấu hình

### Cấu hình tĩnh

Các giá trị kết nối đọc từ environment và cần restart khi thay đổi:

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `MC_HOST` | bắt buộc | Minecraft server host |
| `MC_PORT` | `25565` | Minecraft server port |
| `MC_USERNAME` | bắt buộc | Email Microsoft hoặc offline username |
| `MC_AUTH` | `microsoft` | `microsoft` hoặc `offline` |
| `MC_VERSION` | `false` | Tự nhận protocol hoặc version như `1.21.4` |
| `MC_PROFILES_FOLDER` | `./profiles` | Authentication cache |
| `DATABASE_URL` | PostgreSQL local | Database connection string |
| `API_PORT` | `3010` | HTTP/UI port |

Các port publish của Docker Compose được cấu hình riêng và luôn bind vào
`127.0.0.1` theo mặc định:

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `SERVICE_PORT_API` | `3010` | Host port publish API/UI |
| `SERVICE_PORT_PG` | `55432` | Host port publish PostgreSQL |
| `POSTGRES_DB` | `order_analytics` | Database do Compose khởi tạo |
| `POSTGRES_USER` | `order_analytics` | PostgreSQL user do Compose khởi tạo |
| `POSTGRES_PASSWORD` | `order_analytics` | PostgreSQL password do Compose khởi tạo |
| `SERVICE_DATABASE_URL` | PostgreSQL service `postgres` | URL collector dùng bên trong Compose |

`DATABASE_URL` dành cho chạy Node.js trực tiếp từ host; `SERVICE_DATABASE_URL`
dành cho container collector. Khi đổi user, password hoặc database, cần cập
nhật `SERVICE_DATABASE_URL` tương ứng. Các giá trị khởi tạo PostgreSQL chỉ có
hiệu lực khi volume database được tạo lần đầu.

Compose nạp `.env` trực tiếp vào collector. PostgreSQL chỉ nhận riêng
`POSTGRES_DB`, `POSTGRES_USER` và `POSTGRES_PASSWORD`, tránh đưa thông tin đăng
nhập Minecraft vào container database.

### Cấu hình động

Các giá trị sau được seed từ `.env` khi database chưa có config, sau đó quản
lý tại UI hoặc `PUT /config`:

- Bật/tắt scheduler.
- Chu kỳ từ 10 giây đến 24 giờ.
- Thời gian chờ GUI từ 0 đến 10 giây.
- Tối đa 200 item, query và trạng thái enable riêng.

Cấu hình lưu trong `app_config` và áp dụng ngay sau khi Save.

## REST API

API không có authentication. Compose mặc định chỉ bind vào loopback.

| Method | Endpoint | Công dụng |
|---|---|---|
| GET | `/` | Config UI |
| GET | `/health` | Trạng thái bot và lần quét gần nhất |
| GET/PUT | `/config` | Đọc/lưu cấu hình động |
| POST | `/scan` | Quét item tùy ý |
| POST | `/scan/:itemId` | Quét item đã cấu hình |
| GET | `/snapshots` | Danh sách snapshot |
| GET | `/opportunities/:itemId` | Price ladder và cơ hội đặt giá |

Ví dụ:

```bash
curl -X POST http://localhost:3010/scan \
  -H 'Content-Type: application/json' \
  -d '{"id":"minecraft:redstone_block","query":"redstone block"}'

curl 'http://localhost:3010/snapshots?itemId=minecraft:redstone_block&limit=20'
curl 'http://localhost:3010/opportunities/minecraft:redstone_block'
```

## Dữ liệu và Grafana

| Bảng hoặc view | Nội dung |
|---|---|
| `app_config` | Cấu hình collector động |
| `order_snapshots` | Summary mỗi lần quét trang 1 |
| `order_entries` | Từng order theo slot |
| `order_price_levels` | Tổng hợp theo mức giá |
| `order_price_opportunities` | Queue giá cao hơn và fill velocity |

```text
remaining = total - delivered
weighted_price = Σ(price × remaining) / Σ(remaining)
higher_price_queue(P) = Σ(remaining tại price > P)
```

`fill_velocity_per_minute` chỉ được tính khi tổng quantity của price bucket
không đổi giữa hai snapshot liên tiếp, tránh xem order mới hoặc order bị đẩy
khỏi trang 1 là volume đã fill.

Kết nối Grafana local:

```text
Host: 127.0.0.1:55432
Database/User/Password: order_analytics
```

Nếu Grafana ở cùng Compose network, dùng `postgres:5432`.

```sql
SELECT observed_at AS time, best_price, total_volume, weighted_price, fill_ratio
FROM order_snapshots
WHERE item_id = 'minecraft:redstone_block' AND $__timeFilter(observed_at)
ORDER BY observed_at;
```

## Kiểm thử

```bash
npm test
node --check src/index.js
node --check src/collector.js
docker compose config
docker compose --profile collector build collector
```

## Giới hạn

- Chỉ thấy top-of-book ở trang đầu, không phải toàn thị trường.
- GUI không cung cấp order ID ổn định; velocity được phân tích theo price bucket.
- Order rời trang đầu không đồng nghĩa chắc chắn đã được giao hết.
- Lore/title/command phụ thuộc server và có thể cần cập nhật parser.

## Khắc phục sự cố

- `Timed out waiting for Orders (Page 1)`: kiểm tra command, title, account và protocol.
- `No order rows parsed`: lấy lore thực tế rồi cập nhật `src/parser.js` và test fixture.
- Microsoft login lặp lại: kiểm tra quyền ghi `profiles/` hoặc volume `auth-profiles`.
- Không kết nối qua ViaVersion: đặt `MC_VERSION` rõ ràng thay vì `false`.
- UI mất style/script: Pico.css và AlpineJS được tải qua CDN từ trình duyệt.
