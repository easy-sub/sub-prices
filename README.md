# Sub Prices

Sub Prices 可以对比不同地区的 AI 订阅价格，支持 OpenAI、Claude、账期切换和货币换算。首次打开使用白天模式，也可以在页面右上角切换主题。

## 部署前准备

- 一台能访问 GitHub、并安装了 Node.js 20 或更新版本的服务器；Docker 部署只需安装 Docker。
- 一个已解析到服务器的域名。使用宝塔或 1Panel 时，先给域名申请 HTTPS 证书。
- Claude 价格查询需要服务器能访问 Claude。若服务器无法直连，可在网页的 Claude 代理设置中填写**服务器能访问的 HTTP 或 HTTPS 代理地址**。

## 宝塔或 1Panel 部署

在服务器终端运行以下命令：

```bash
git clone https://github.com/easy-sub/sub-prices.git
cd sub-prices
corepack enable
pnpm install --frozen-lockfile
pnpm run build
PORT=3000 HOST=127.0.0.1 pnpm start
```

看到 `Sub Prices listening` 后，可先在服务器上访问 `http://127.0.0.1:3000`。正式运行时，请把最后一条命令加入宝塔的进程守护管理器或 1Panel 的进程守护，并设置为开机启动。工作目录填 `sub-prices` 的完整路径，启动命令填 `pnpm start`，环境变量填 `PORT=3000` 和 `HOST=127.0.0.1`。

然后在宝塔或 1Panel 中新建网站、绑定域名并启用 HTTPS。在网站的「反向代理」中新增代理，代理目录填 `/`，目标 URL 填 `http://127.0.0.1:3000`。保存后访问你的域名即可。网页和价格接口共用这个地址，不需要再单独设置 `/api` 反向代理。

如果使用 GitHub Releases 中的 `sub-prices-web.tar.gz`，也可以将压缩包上传到服务器并解压到一个空目录。它包含 `dist` 和 `build` 两个目录；在解压目录中运行 `PORT=3000 HOST=127.0.0.1 node build/server.cjs`，再按上面的步骤配置进程守护和网站反向代理。

## Docker 部署

在安装了 Docker 的服务器上运行：

```bash
git clone https://github.com/easy-sub/sub-prices.git
cd sub-prices
docker build -t sub-prices .
docker run -d --name sub-prices --restart unless-stopped -p 127.0.0.1:3000:3000 sub-prices
```

在宝塔或 1Panel 中给域名添加网站和 HTTPS 证书，再新增反向代理：代理目录填 `/`，目标 URL 填 `http://127.0.0.1:3000`。保存后访问域名即可。

更新版本时，在项目目录运行 `git pull`，然后重新运行 `docker build -t sub-prices .`。接着执行 `docker stop sub-prices`、`docker rm sub-prices`，最后重新执行上面的 `docker run` 命令。

## 本地开发

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

默认访问地址为 `http://127.0.0.1:5176`。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
