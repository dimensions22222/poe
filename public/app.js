const panel = document.querySelector("#authPanel");
const overlay = document.querySelector("#authOverlay");
const form = document.querySelector("#authForm");
const title = document.querySelector("#authTitle");
const subtitle = document.querySelector("#authSubtitle");
const submitText = document.querySelector("#submitText");
const switchCopy = document.querySelector("#switchCopy");
const message = document.querySelector("#formMessage");
let mode = "login";

function setMode(nextMode) {
  mode = nextMode;
  const signup = mode === "signup";
  title.textContent = signup ? "Start seeing clearly." : "Welcome back.";
  subtitle.textContent = signup
    ? "Create your free intelligence workspace."
    : "Log in to see what’s changing.";
  submitText.textContent = signup ? "Create my workspace" : "Log in";
  document.querySelectorAll(".signup-only").forEach((element) => {
    element.hidden = !signup;
  });
  document.querySelector(".login-only").hidden = signup;
  form.elements.password.autocomplete = signup ? "new-password" : "current-password";
  switchCopy.innerHTML = signup
    ? 'Already have an account? <button type="button" data-switch-auth="login">Log in</button>'
    : 'New to ULTRON? <button type="button" data-switch-auth="signup">Create an account</button>';
  message.textContent = "";
}

function openAuth(nextMode) {
  setMode(nextMode);
  overlay.hidden = false;
  panel.hidden = false;
  panel.classList.add("is-open");
  document.body.style.overflow = "hidden";
  setTimeout(() => form.elements.email.focus(), 80);
}

function closeAuth() {
  panel.hidden = true;
  overlay.hidden = true;
  panel.classList.remove("is-open");
  document.body.style.overflow = "";
}

document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-open-auth]");
  if (opener) openAuth(opener.dataset.openAuth);
  if (event.target.closest("#closeAuth") || event.target === overlay) closeAuth();
  const switcher = event.target.closest("[data-switch-auth]");
  if (switcher) setMode(switcher.dataset.switchAuth);
  const passwordButton = event.target.closest(".show-password");
  if (passwordButton) {
    const input = passwordButton.previousElementSibling;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    passwordButton.textContent = reveal ? "Hide" : "Show";
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !panel.hidden) closeAuth();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const firstName = form.elements.name.value.trim().split(" ")[0] || "there";
  message.textContent = mode === "signup"
    ? `Welcome, ${firstName}. Your workspace is ready to explore.`
    : "You’re in. Opening your intelligence workspace…";
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  setTimeout(() => {
    submit.disabled = false;
    window.location.assign("ultron.html");
  }, 1400);
});
