import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const login = process.env.GITHUB_LOGIN || "karlmoriaty";
const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN or PROFILE_TOKEN is required");
  process.exit(1);
}

const EXTRA_REPOS = [
  "karlmoriaty/runesvaner",
  "karlmoriaty/ClientLedger",
  "karlmoriaty/markdig",
  "karlmoriaty/XSocialMiner",
  "karlmoriaty/OfficeCTRL",
  "karlmoriaty/RunesHela",
];

const REPO_FIELDS = `name
          nameWithOwner
          url
          description
          stargazerCount
          forkCount
          isArchived
          isPrivate
          isFork
          primaryLanguage {
            name
            color
          }`;

const extraSelections = EXTRA_REPOS.map((fullName, index) => {
  const [owner, name] = fullName.split("/");
  return `extra${index}: repository(owner: "${owner}", name: "${name}") { ${REPO_FIELDS} }`;
}).join("\n");

const query = `query($login: String!) {
  user(login: $login) {
    pinnedItems(first: 6, types: [REPOSITORY]) {
      nodes {
        ... on Repository {
          ${REPO_FIELDS}
        }
      }
    }
  }
  ${extraSelections}
}`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "profile-repository-cards",
  },
  body: JSON.stringify({ query, variables: { login } }),
});
const payload = await response.json();
if (!response.ok || payload.errors) {
  console.error(JSON.stringify(payload.errors || payload, null, 2));
  process.exit(1);
}

const DISPLAY_ORDER = [
  "AxurePR-return-rp",
  "interior-moodboard-3d",
  "handlebars-rust",
  "neocmakelsp",
];

const pinned = (payload.data?.user?.pinnedItems.nodes || []).filter(Boolean);
const extras = EXTRA_REPOS.map((_, index) => payload.data?.[`extra${index}`]).filter(Boolean);
const seen = new Set();
const fetched = [...pinned, ...extras].filter((repo) => {
  if (!repo || !repo.name || repo.isPrivate) return false;
  if (seen.has(repo.nameWithOwner)) return false;
  seen.add(repo.nameWithOwner);
  return true;
});
if (fetched.length === 0) {
  console.error(`no public pinned repositories for ${login}`);
  process.exit(1);
}

const byName = new Map(fetched.map((repo) => [repo.name, repo]));
const repos = [
  ...DISPLAY_ORDER.map((name) => byName.get(name)).filter(Boolean),
  ...fetched.filter((repo) => !DISPLAY_ORDER.includes(repo.name)),
];

const ICONS = {
  repo: "M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z",
  star: "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z",
  fork: "M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z",
};

const themes = {
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    title: "#0969da",
    text: "#57606a",
    icon: "#57606a",
    badgeBorder: "#d4a72c",
    badgeText: "#9a6700",
  },
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    title: "#2f81f7",
    text: "#8b949e",
    icon: "#8b949e",
    badgeBorder: "#9e6a03",
    badgeText: "#d29922",
  },
};

const CARD_WIDTH = 420;
const CARD_HEIGHT = 152;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugOf(name) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function unitsOf(char) {
  return char.codePointAt(0) > 0x2e7f ? 12.4 : 6.2;
}

function widthOf(text) {
  let width = 0;
  for (const char of text) width += unitsOf(char);
  return width;
}

function truncateToWidth(line, maxWidth) {
  let out = "";
  let width = 0;
  for (const char of line) {
    const units = unitsOf(char);
    if (width + units > maxWidth - 12.4) break;
    out += char;
    width += units;
  }
  out = out.trimEnd();
  const spaceIndex = out.lastIndexOf(" ");
  if (spaceIndex > out.length * 0.6) out = out.slice(0, spaceIndex).trimEnd();
  return `${out}…`;
}

function wrapDescription(text, maxWidth = 386, maxLines = 2) {
  const source = String(text || "").trim().replace(/\s+/g, " ");
  if (!source) return [];
  const lines = [];
  let line = "";
  let width = 0;

  const finish = (value) => {
    const clean = value.trimEnd();
    if (clean) lines.push(clean);
  };

  for (const char of source) {
    const units = unitsOf(char);
    if (width + units <= maxWidth) {
      line += char;
      width += units;
      continue;
    }
    if (lines.length + 1 >= maxLines) {
      finish(truncateToWidth(line, maxWidth));
      return lines;
    }
    const spaceIndex = line.lastIndexOf(" ");
    const head = spaceIndex > 0 ? line.slice(0, spaceIndex) : "";
    if (head && widthOf(head) >= maxWidth * 0.5) {
      finish(head);
      line = line.slice(spaceIndex + 1) + (char === " " ? "" : char);
    } else {
      finish(line);
      line = char === " " ? "" : char;
    }
    line = line.replace(/^ +/, "");
    width = widthOf(line);
  }
  finish(line);
  return lines;
}

function truncateName(name) {
  const chars = Array.from(name);
  return chars.length > 34 ? `${chars.slice(0, 33).join("")}…` : name;
}

function cardSvg(repo, themeName) {
  const colors = themes[themeName];
  const lines = wrapDescription(repo.description);
  const language = repo.primaryLanguage;
  const footerY = 126;
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${esc(repo.name)}">`,
  );
  parts.push(
    '<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}</style>',
  );
  parts.push(
    `<rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="6" fill="${colors.bg}" stroke="${colors.border}"/>`,
  );
  parts.push(
    `<g transform="translate(16,19) scale(0.9)" fill="${colors.icon}"><path d="${ICONS.repo}"/></g>`,
  );
  parts.push(
    `<text x="35" y="32" fill="${colors.title}" font-size="14" font-weight="600">${esc(truncateName(repo.name))}</text>`,
  );

  if (repo.isArchived) {
    parts.push(
      `<rect x="${CARD_WIDTH - 88}" y="18" width="72" height="20" rx="10" fill="none" stroke="${colors.badgeBorder}"/>`,
    );
    parts.push(
      `<text x="${CARD_WIDTH - 52}" y="32" text-anchor="middle" fill="${colors.badgeText}" font-size="11">Archived</text>`,
    );
  }

  lines.forEach((line, index) => {
    parts.push(
      `<text x="16" y="${60 + index * 17}" fill="${colors.text}" font-size="12">${esc(line)}</text>`,
    );
  });

  if (language) {
    parts.push(
      `<circle cx="22" cy="${footerY - 4}" r="6" fill="${esc(language.color || "#8b949e")}"/>`,
    );
    parts.push(
      `<text x="34" y="${footerY}" fill="${colors.text}" font-size="12">${esc(language.name)}</text>`,
    );
  }

  parts.push(
    `<g transform="translate(160,${footerY - 12}) scale(0.75)" fill="${colors.icon}"><path d="${ICONS.star}"/></g>`,
  );
  parts.push(
    `<text x="175" y="${footerY}" fill="${colors.text}" font-size="12">${repo.stargazerCount}</text>`,
  );
  parts.push(
    `<g transform="translate(232,${footerY - 12}) scale(0.75)" fill="${colors.icon}"><path d="${ICONS.fork}"/></g>`,
  );
  parts.push(
    `<text x="247" y="${footerY}" fill="${colors.text}" font-size="12">${repo.forkCount}</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

const RAW_BASE = `https://raw.githubusercontent.com/${login}/${login}/main/assets/repos`;
const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
const START = "<!-- repositories:start -->";
const END = "<!-- repositories:end -->";

function readmeBlock() {
  const rows = [];
  for (let index = 0; index < repos.length; index += 2) {
    const pair = repos.slice(index, index + 2);
    const cells = pair.map((repo) => {
      const slug = slugOf(repo.name);
      return `<a href="${esc(repo.url)}"><picture>
<source media="(prefers-color-scheme: dark)" srcset="${RAW_BASE}/dark/${slug}.svg">
<img src="${RAW_BASE}/light/${slug}.svg" alt="${esc(repo.name)}" width="48%">
</picture></a>`;
    });
    while (cells.length < 2) cells.push("");
    rows.push(`<p align="center">\n${cells.join("\n")}\n</p>`);
  }
  return rows.join("\n\n");
}

const assetsDir = fileURLToPath(new URL("../assets/repos/", import.meta.url));
const slugs = repos.map((repo) => slugOf(repo.name));
for (const themeName of ["light", "dark"]) {
  const dir = `${assetsDir}${themeName}`;
  mkdirSync(dir, { recursive: true });
  for (const repo of repos) {
    writeFileSync(`${dir}/${slugOf(repo.name)}.svg`, cardSvg(repo, themeName));
  }
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".svg") && !slugs.includes(file.slice(0, -4))) {
      unlinkSync(`${dir}/${file}`);
    }
  }
}

const readme = readFileSync(readmePath, "utf8");
const startIndex = readme.indexOf(START);
const endIndex = readme.indexOf(END);
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  console.error("repositories markers missing in README.md");
  process.exit(1);
}
const next = `${readme.slice(0, startIndex + START.length)}\n${readmeBlock()}\n${readme.slice(endIndex)}`;
writeFileSync(readmePath, next);

console.log(`updated ${repos.length} repository cards: ${repos.map((repo) => repo.name).join(", ")}`);