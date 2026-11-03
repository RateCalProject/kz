// Supabase の設定
// この anon（publishable）キーは公開して大丈夫なキーです。secret / service_role キーは絶対にここに書かないでください。
window.AILINAX_CONFIG = {
  url: "https://api.a-ruri.com",
  anonKey: "sb_publishable_IXjYMIgwjO9YCrJz7edgT__ts0sTDaS",
  ads: { client: "ca-pub-8527280731414386", reward: "", banner: "" },   // Google AdSense（公開してよい番号）。reward・banner は審査が通ってから広告ユニットの番号を入れる
  ebiRelay: false   // 空飛ぶエビフライの中継（Realtime）は自宅では使わない（直接つなぐ方式になる）
};
