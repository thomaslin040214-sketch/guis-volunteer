/* ============================================================
   GUIS 义工组织 — 云服务公共配置
   这两个值来自 workbuddy_cloud_service 激活时返回的 publicConfig。
   publishableKey 只标识应用、本身不带权限（服务端强制 Origin 精确匹配），
   因此可以安全地放在前端源码里。
   ============================================================ */
window.CLOUD_PUBLIC_CONFIG = {
  endpoint: "https://guis-volunteer.app.workbuddy.host",
  publishableKey: "wbpk_OYzDuA98iG5mwRrAamtnrQ_nxltEW0NkzS1F0R0Des3TTM93hNqG7o5"
};
