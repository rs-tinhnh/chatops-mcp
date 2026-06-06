# chatops-mcp

MCP server để đọc và trả lời tin nhắn trên Mattermost (vd `chat.runsystem.vn`).

## Cài đặt / build

```bash
npm install
npm run build
npx playwright install chromium   # tải Chromium cho login SSO
```

## Cấu hình

### 1. Tạo `.env`

Tạo file `.env` ở thư mục gốc project (đã nằm trong `.gitignore`, không commit):

```bash
MATTERMOST_URL="https://chat.runsystem.vn"
MATTERMOST_USERNAME=your.username
MATTERMOST_PASSWORD=your-password
```

`scripts/run-mcp.sh` sẽ load `.env` rồi chạy `dist/bin.js` — nhờ vậy credential
chỉ nằm **một chỗ** (`.env`), không phải copy vào config của từng IDE. Cấp
quyền chạy một lần:

```bash
chmod +x scripts/run-mcp.sh
```

### 2. Tích hợp vào Claude Code

```bash
claude mcp add chatops <đường-dẫn-tuyệt-đối>/chatops-mcp/scripts/run-mcp.sh
```

Hoặc khai báo thủ công trong `.mcp.json` / `~/.claude.json`:

```json
{
  "mcpServers": {
    "chatops": {
      "command": "<đường-dẫn-tuyệt-đối>/chatops-mcp/scripts/run-mcp.sh"
    }
  }
}
```

Kiểm tra bằng `claude mcp list` — `chatops` phải hiện `✓ Connected`.

### 3. Tích hợp vào Cursor

Thêm vào `.cursor/mcp.json` (theo project) hoặc `~/.cursor/mcp.json` (toàn cục):

```json
{
  "mcpServers": {
    "chatops": {
      "command": "<đường-dẫn-tuyệt-đối>/chatops-mcp/scripts/run-mcp.sh"
    }
  }
}
```

Mở lại Cursor (hoặc reload MCP trong Settings → MCP) để tool `chatops` xuất hiện.

> Không muốn dùng `scripts/run-mcp.sh`? Có thể trỏ `command`/`args` thẳng vào
> `node dist/bin.js` và truyền credential qua khối `env` trong config JSON ở
> trên — nhưng khi đó mỗi IDE sẽ giữ một bản copy riêng của password.

### Đăng nhập SSO & session

Login đi qua SSO Keycloak (`sso.runsystem.vn`): server mở Chromium (Playwright),
điền `MATTERMOST_USERNAME`/`MATTERMOST_PASSWORD` vào form đăng nhập, rồi lấy
session token. Env phụ: `CHATOPS_HEADFUL=1` để xem browser, `CHATOPS_LOGIN_TIMEOUT_MS`
(mặc định 30000), `CHATOPS_SESSION_PATH` để đổi nơi lưu session.

Credential chỉ nằm trong env (không log). Session token được lưu ra
`~/.chatops-mcp/session.json` (quyền 600) và tái dùng tới khi hết hạn; khi gặp
401 server tự đăng nhập SSO lại.

## Tool

Đọc: `list_channels`, `read_channel`, `read_thread`, `search_messages`
Gửi: `send_message`, `reply_to_thread`, `send_direct_message`
Phụ trợ: `find_user`

Tool nhận **tên** channel/username; server tự resolve sang ID và cache.

## Test

```bash
npm test          # unit test (mock HTTP, không gọi server thật)
# smoke test thật (cần env + tên 1 channel bạn đang tham gia):
MATTERMOST_URL=https://chat.runsystem.vn MATTERMOST_USERNAME=you MATTERMOST_PASSWORD=pw CHANNEL=town-square npm run smoke
```
