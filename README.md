# chatops-mcp

MCP server để đọc và trả lời tin nhắn trên Mattermost (vd `chat.runsystem.vn`).

## Cài đặt / build

```bash
npm install
npm run build
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

Credential chỉ nằm trong env (không ghi ra disk, không log). Session token chỉ giữ trong RAM; tự login lại khi hết hạn.

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
