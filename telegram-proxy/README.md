# EdgeChat Telegram Proxy

This Worker is a restricted Telegram Bot API relay for EdgeChat.

It does **not** accept arbitrary URLs. The only upstream targets are Telegram Bot API method calls and Telegram file paths.

Required secret:

```bash
wrangler secret put PROXY_SECRET
```

The EdgeChat Worker sends:

- `X-EdgeChat-Proxy-Secret`
- `X-EdgeChat-Telegram-Bot-Token`

The bot token is deliberately kept out of the proxy URL, access logs and browser-visible file URLs.

## File path compatibility

The relay supports the EdgeChat-specific `/bot/<method>` and `/file/<telegram-file-path>` forms as well as the legacy `/bot<TOKEN>/<method>` and `/file/bot<TOKEN>/...` forms. The preferred EdgeChat form keeps the Bot Token in `X-EdgeChat-Telegram-Bot-Token` and never places it in the URL.
