# chatops-mcp

MCP server để đọc và trả lời tin nhắn trên Mattermost (vd `chat.runsystem.vn`).

## Cài đặt / build

```bash
npm install
npm run build
npx playwright install chromium   # tải Chromium cho login SSO
```

## Cấu hình trong Claude (`.mcp.json` hoặc `claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "chatops": {
      "command": "node",
      "args": ["<đường-dẫn-tuyệt-đối>/chatops-mcp/dist/bin.js"],
      "env": {
        "MATTERMOST_URL": "https://chat.runsystem.vn",
        "MATTERMOST_USERNAME": "your.username",
        "MATTERMOST_PASSWORD": "your-password"
      }
    }
  }
}
```

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
