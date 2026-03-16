import "./style.css";

const savedTheme = localStorage.getItem("theme") || "dark";
document.documentElement.classList.toggle("light-theme", savedTheme === "light");

document.querySelector("#app").innerHTML = `
  <main class="vite-note">
    <h1>Vite initialized</h1>
    <p>Chrome extension UI is implemented in popup.html.</p>
  </main>
`;
