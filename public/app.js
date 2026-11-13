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

// A dependency-free canvas scene keeps the landing visual as responsive as the
// workspace itself. It is a small 3D signal model, generated entirely from math
// rather than an exported image or a third-party WebGL asset.
const canvas = document.querySelector("#intelligenceCanvas");

if (canvas) {
  const context = canvas.getContext("2d");
  const count = 128;
  const nodeCount = document.querySelector("#nodeCount");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const nodes = Array.from({ length: count }, (_, index) => {
    const y = 1 - (index / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    return {
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
      phase: index * 0.37,
    };
  });
  const edges = nodes.flatMap((_, index) => [
    [index, (index + 1) % count],
    [index, (index + 8) % count],
    [index, (index + 21) % count],
  ]);
  let width = 1;
  let height = 1;
  let rotationX = -0.22;
  let rotationY = 0.6;
  let targetX = rotationX;
  let targetY = rotationY;
  let dragging = false;
  let lastPointer = null;
  let frame;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function rotate(point, extraY = 0) {
    const yAngle = rotationY + extraY;
    const cosY = Math.cos(yAngle);
    const sinY = Math.sin(yAngle);
    const x = point.x * cosY - point.z * sinY;
    const z = point.x * sinY + point.z * cosY;
    const cosX = Math.cos(rotationX);
    const sinX = Math.sin(rotationX);
    return { x, y: point.y * cosX - z * sinX, z: point.y * sinX + z * cosX };
  }

  function project(point, scale) {
    const perspective = 3.6 / (3.6 - point.z);
    return {
      x: width / 2 + point.x * scale * perspective,
      y: height / 2 + point.y * scale * perspective,
      z: point.z,
      scale: perspective,
    };
  }

  function drawRing(tilt, color) {
    context.beginPath();
    for (let step = 0; step <= 72; step += 1) {
      const angle = (step / 72) * Math.PI * 2;
      const point = rotate({
        x: Math.cos(angle),
        y: Math.sin(angle) * Math.sin(tilt),
        z: Math.sin(angle) * Math.cos(tilt),
      });
      const screen = project(point, Math.min(width, height) * 0.27);
      if (step === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    }
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.stroke();
  }

  function render(time = 0) {
    rotationX += (targetX - rotationX) * 0.08;
    rotationY += (targetY - rotationY) * 0.08;
    if (!dragging && !reduceMotion.matches) targetY += 0.0024;

    context.clearRect(0, 0, width, height);
    const size = Math.min(width, height) * 0.27;
    const transformed = nodes.map((node) => ({
      ...project(rotate(node), size),
      phase: node.phase,
    }));

    context.save();
    context.globalCompositeOperation = "lighter";
    drawRing(0.12, "#77a9ef36");
    drawRing(0.88, "#e34b5640");
    drawRing(-0.58, "#63bd8530");

    edges.forEach(([from, to]) => {
      const a = transformed[from];
      const b = transformed[to];
      const depth = Math.max(0.08, ((a.z + b.z + 2) / 4) * 0.35);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.strokeStyle = `rgba(119, 169, 239, ${depth})`;
      context.lineWidth = 0.65;
      context.stroke();
    });

    transformed.sort((a, b) => a.z - b.z).forEach((node, index) => {
      const brightness = (node.z + 1) / 2;
      const pulse = 0.75 + Math.sin(time * 0.002 + node.phase) * 0.2;
      const radius = (1 + brightness * 1.8) * node.scale * pulse;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      context.fillStyle = index % 11 === 0
        ? `rgba(240, 92, 102, ${0.35 + brightness * 0.65})`
        : `rgba(210, 222, 237, ${0.18 + brightness * 0.75})`;
      context.fill();
    });
    context.restore();

    if (!reduceMotion.matches || dragging) frame = requestAnimationFrame(render);
  }

  function updatePointer(event) {
    if (!lastPointer) return;
    targetY += (event.clientX - lastPointer.x) * 0.012;
    targetX += (event.clientY - lastPointer.y) * 0.012;
    targetX = Math.max(-1.05, Math.min(1.05, targetX));
    lastPointer = { x: event.clientX, y: event.clientY };
  }

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    if (reduceMotion.matches) render(performance.now());
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    updatePointer(event);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
    canvas.addEventListener(type, () => {
      dragging = false;
      lastPointer = null;
    });
  });

  new ResizeObserver(() => {
    resize();
    if (reduceMotion.matches) render(performance.now());
  }).observe(canvas);
  reduceMotion.addEventListener("change", () => {
    cancelAnimationFrame(frame);
    frame = 0;
    render(performance.now());
  });
  if (nodeCount) nodeCount.textContent = String(count);
  resize();
  render();
}
