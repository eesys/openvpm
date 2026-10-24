export default function HomePage() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>OpenVPM</h1>
      <p>诊所应用已启动。</p>
      <p>
        <a href="/login">登录</a>
        {" · "}
        <a href="/clients">客户</a>
        {" · "}
        <a href="/schedule">日程</a>
        {" · "}
        <a href="/billing">账单</a>
        {" · "}
        <a href="/inventory">库存</a>
        {" · "}
        <a href="/whiteboard">白板</a>
      </p>
    </main>
  );
}
