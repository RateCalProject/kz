// Supabase の設定
// この anon（publishable）キーは公開して大丈夫なキーです。secret / service_role キーは絶対にここに書かないでください。
window.AILINAX_CONFIG = {
  url: "https://api.a-ruri.com",
  anonKey: "sb_publishable_IXjYMIgwjO9YCrJz7edgT__ts0sTDaS",
  ebiRelay: false   // 空飛ぶエビフライの中継（Realtime）は自宅では使わない（直接つなぐ方式になる）
};
