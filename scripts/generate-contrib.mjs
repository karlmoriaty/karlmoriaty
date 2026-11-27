import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const login = process.env.GITHUB_LOGIN || "karlmoriaty";
const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN or PROFILE_TOKEN is required");
  process.exit(1);
}

const now = new Date();
const year = Number(process.env.YEAR) || now.getUTCFullYear();
const from = `${year}-01-01T00:00:00Z`;
const to = year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z`;

const query = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "profile-contribution-cards",
  },
  body: JSON.stringify({ query, variables: { login, from, to } }),
});
const payload = await response.json();
if (!response.ok || payload.errors) {
  console.error(JSON.stringify(payload.errors || payload, null, 2));
  process.exit(1);
}

const collection = payload.data?.user?.contributionsCollection;
if (!collection) {
  console.error("contributionsCollection missing for", login);
  process.exit(1);
}

const dayByDate = new Map();
for (const week of collection.contributionCalendar.weeks) {
  for (const day of week.contributionDays) {
    if (Number(day.date.slice(0, 4)) === year) dayByDate.set(day.date, day);
  }
}

const start = new Date(Date.UTC(year, 0, 1));
start.setUTCDate(start.getUTCDate() - start.getUTCDay());
const end = new Date(Date.UTC(year, 11, 31));
end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

const weeks = [];
for (const cursor = new Date(start); cursor <= end; ) {
  const week = [];
  for (let i = 0; i < 7; i++) {
    const date = cursor.toISOString().slice(0, 10);
    const inYear = Number(date.slice(0, 4)) === year;
    const found = inYear ? dayByDate.get(date) : null;
    week.push({
      date,
      inYear,
      count: found?.contributionCount ?? 0,
      level: found?.contributionLevel ?? "NONE",
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  weeks.push(week);
}

const total = collection.contributionCalendar.totalContributions;
const themes = {
  light: {
    title: "#24292f",
    text: "#57606a",
    grid: "#d0d7de",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    accent: "#2da44e",
  },
  dark: {
    title: "#c9d1d9",
    text: "#8b949e",
    grid: "#30363d",
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    accent: "#3fb950",
  },
};

const levelIndex = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function levelOf(day) {
  if (levelIndex[day.level] !== undefined) return levelIndex[day.level];
  if (day.count === 0) return 0;
  if (day.count <= 3) return 1;
  if (day.count <= 6) return 2;
  if (day.count <= 9) return 3;
  return 4;
}

function heatmapSvg(theme) {
  const colors = themes[theme];
  const cell = 11;
  const pitch = 14;
  const left = 34;
  const top = 38;
  const width = left + weeks.length * pitch + 18;
  const height = top + 7 * pitch + 32;
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${total} contributions in ${year}`)}">`,
  );
  parts.push(
    `<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}</style>`,
  );
  parts.push(
    `<text x="0" y="14" fill="${colors.title}" font-size="14" font-weight="600">${total} contributions in ${year}</text>`,
  );

  let lastMonth = -1;
  let lastLabelX = -100;
  weeks.forEach((week, weekIndex) => {
    const first = week.find((day) => day.inYear);
    if (!first) return;
    const month = Number(first.date.slice(5, 7)) - 1;
    if (month === lastMonth) return;
    lastMonth = month;
    const x = left + weekIndex * pitch;
    if (x - lastLabelX < 30) return;
    lastLabelX = x;
    parts.push(`<text x="${x}" y="${top - 6}" fill="${colors.text}" font-size="10">${months[month]}</text>`);
  });

  ["Mon", "Wed", "Fri"].forEach((label, index) => {
    const row = index * 2 + 1;
    parts.push(
      `<text x="0" y="${top + row * pitch + 9}" fill="${colors.text}" font-size="10">${label}</text>`,
    );
  });

  weeks.forEach((week, weekIndex) => {
    week.forEach((day, dayIndex) => {
      if (!day.inYear) return;
      const x = left + weekIndex * pitch;
      const y = top + dayIndex * pitch;
      const title = `${day.count} contribution${day.count === 1 ? "" : "s"} on ${day.date}`;
      parts.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${colors.levels[levelOf(day)]}"><title>${esc(title)}</title></rect>`,
      );
    });
  });

  const legendY = top + 7 * pitch + 8;
  const legendStart = width - 130;
  parts.push(
    `<text x="${legendStart}" y="${legendY + 9}" fill="${colors.text}" font-size="10">Less</text>`,
  );
  colors.levels.forEach((fill, index) => {
    parts.push(
      `<rect x="${legendStart + 30 + index * 13}" y="${legendY}" width="10" height="10" rx="2" fill="${fill}" />`,
    );
  });
  parts.push(
    `<text x="${legendStart + 30 + 5 * 13 + 4}" y="${legendY + 9}" fill="${colors.text}" font-size="10">More</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

const values = [
  collection.totalPullRequestReviewContributions,
  collection.totalIssueContributions,
  collection.totalPullRequestContributions,
  collection.totalCommitContributions,
];

function percentages(numbers) {
  const sum = numbers.reduce((acc, value) => acc + value, 0);
  if (sum === 0) return numbers.map(() => 0);
  const raw = numbers.map((value) => (value / sum) * 100);
  const result = raw.map(Math.floor);
  let remaining = 100 - result.reduce((acc, value) => acc + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remaining; i++) result[order[i % order.length].index] += 1;
  return result;
}

function radarSvg(theme) {
  const colors = themes[theme];
  const width = 440;
  const height = 340;
  const cx = width / 2;
  const cy = 172;
  const radius = 96;
  const labelRadius = radius + 32;
  const axes = [
    { label: "Code review", value: values[0], angle: -Math.PI / 2 },
    { label: "Issues", value: values[1], angle: 0 },
    { label: "Pull requests", value: values[2], angle: Math.PI / 2 },
    { label: "Commits", value: values[3], angle: Math.PI },
  ];
  const max = Math.max(1, ...axes.map((axis) => axis.value));
  const percents = percentages(axes.map((axis) => axis.value));
  const point = (value, angle) => [
    cx + Math.cos(angle) * value,
    cy + Math.sin(angle) * value,
  ];
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(
      `Contribution breakdown for ${year}: ${axes.map((axis, index) => `${axis.label} ${percents[index]}%`).join(", ")}`,
    )}">`,
  );
  parts.push(
    `<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}</style>`,
  );
  parts.push(
    `<text x="${cx}" y="22" text-anchor="middle" fill="${colors.title}" font-size="13" font-weight="600">Contribution breakdown (${year})</text>`,
  );

  for (const scale of [0.25, 0.5, 0.75, 1]) {
    const points = axes
      .map((axis) => point(radius * scale, axis.angle).map((n) => n.toFixed(1)).join(","))
      .join(" ");
    parts.push(
      `<polygon points="${points}" fill="none" stroke="${colors.grid}" stroke-width="1" />`,
    );
  }

  axes.forEach((axis) => {
    const [x, y] = point(radius, axis.angle);
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${colors.grid}" stroke-width="1" />`,
    );
  });

  const polygon = axes
    .map((axis) => point((axis.value / max) * radius, axis.angle).map((n) => n.toFixed(1)).join(","))
    .join(" ");
  parts.push(
    `<polygon points="${polygon}" fill="${colors.accent}" fill-opacity="0.22" stroke="${colors.accent}" stroke-width="2" stroke-linejoin="round" />`,
  );

  axes.forEach((axis, index) => {
    const [x, y] = point((axis.value / max) * radius, axis.angle);
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${colors.accent}"><title>${esc(
        `${axis.label}: ${axis.value} (${percents[index]}%)`,
      )}</title></circle>`,
    );

    const [labelX, labelY] = point(labelRadius, axis.angle);
    let anchor = "middle";
    let offsetY = 0;
    if (Math.cos(axis.angle) > 0.1) anchor = "start";
    if (Math.cos(axis.angle) < -0.1) anchor = "end";
    if (Math.sin(axis.angle) < -0.1) offsetY = -6;
    if (Math.sin(axis.angle) > 0.1) offsetY = 12;
    parts.push(
      `<text x="${labelX.toFixed(1)}" y="${(labelY + offsetY).toFixed(1)}" text-anchor="${anchor}" fill="${colors.title}" font-size="12" font-weight="600">${percents[index]}%</text>`,
    );
    parts.push(
      `<text x="${labelX.toFixed(1)}" y="${(labelY + offsetY + 14).toFixed(1)}" text-anchor="${anchor}" fill="${colors.text}" font-size="11">${esc(axis.label)}</text>`,
    );
  });

  parts.push("</svg>");
  return parts.join("");
}

const outDir = fileURLToPath(new URL("../assets/", import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const theme of ["light", "dark"]) {
  writeFileSync(`${outDir}/contrib-heatmap-${theme}.svg`, heatmapSvg(theme));
  writeFileSync(`${outDir}/contrib-radar-${theme}.svg`, radarSvg(theme));
}
console.log(`updated ${year}: ${total} contributions`);