"use client";
import { useState } from "react";
import {
  ChartNoAxesCombined,
  Sparkles,
  UsersRound,
  Eye,
  Heart,
  FileCheck2,
  Download,
  CalendarDays,
  Link2,
  Filter,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { AssetPreview, Badge, Empty, Platform } from "../ui";
import { clientMatch, csv } from "@/lib/domain";
import { downloadFile } from "@/lib/assets";
export function ReportsScreen() {
  const { data, clientId, setClientId, toast } = useWorkspace();
  const [period, setPeriod] = useState("2026-09");
  const [platform, setPlatform] = useState("all");
  const [compare, setCompare] = useState("Previous period");
  const posts = data.posts.filter(
    (p) =>
      p.status === "Published" &&
      p.date.startsWith(period) &&
      clientMatch(p.clientId, clientId) &&
      (platform === "all" || p.platform === platform),
  );
  const reach = posts.reduce((n, p) => n + (p.metrics?.reach || 0), 0),
    engagements = posts.reduce((n, p) => n + (p.metrics?.engagements || 0), 0),
    leads = posts.reduce((n, p) => n + (p.metrics?.leads || 0), 0);
  const weeks = [1, 2, 3, 4].map((week) =>
    posts
      .filter(
        (p) => Math.min(4, Math.ceil(Number(p.date.slice(-2)) / 7)) === week,
      )
      .reduce((n, p) => n + (p.metrics?.reach || 0), 0),
  );
  const max = Math.max(...weeks, 1) * 1.3;
  const points = weeks
    .map((n, i) => `${70 + i * 200},${185 - (n / max) * 150}`)
    .join(" ");
  function exportReport() {
    downloadFile(
      csv([
        ["GrailHiiv demo report", "Period", period],
        [
          "Title",
          "Client",
          "Platform",
          "Published",
          "Reach",
          "Engagements",
          "Attributed leads",
        ],
        ...posts.map((p) => [
          p.title,
          data.clients.find((c) => c.id === p.clientId)?.name || "",
          p.platform,
          p.date,
          p.metrics?.reach || 0,
          p.metrics?.engagements || 0,
          p.metrics?.leads || 0,
        ]),
      ]),
      `grailhiiv-report-${period}.csv`,
    );
    toast("Demo report exported");
  }
  const metrics = [
    ["Reach", reach.toLocaleString(), Eye],
    [
      "Engagement rate",
      reach ? ((engagements / reach) * 100).toFixed(1) + "%" : "—",
      Heart,
    ],
    ["New leads", leads, UsersRound],
    ["Posts published", posts.length, FileCheck2],
  ] as const;
  const sourceImages = [
    "report-cafe",
    "report-villas",
    "report-interior",
    "report-resort",
  ];
  return (
    <>
      <button
        className="visually-hidden"
        id="export-report"
        onClick={exportReport}
      >
        Export demo report
      </button>
      <div className="panel report-filters">
        <label>
          Client
          <select
            aria-label="Report client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="all">All clients</option>
            {data.clients.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date range
          <input
            type="month"
            aria-label="Reporting period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <label>
          Platforms
          <select
            aria-label="Report platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="all">All platforms</option>
            {["Instagram", "Facebook", "LinkedIn"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Compare
          <select
            aria-label="Compare period"
            value={compare}
            onChange={(e) => setCompare(e.target.value)}
          >
            <option>Previous period</option>
            <option>No comparison</option>
          </select>
        </label>
      </div>
      <div className="metric-grid">
        {metrics.map(([label, value, Icon]) => (
          <div className="metric-card" key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <span className="metric-icon">
                <Icon size={23} />
              </span>
            </div>
            <strong>{value}</strong>
            <small>Sample analytics · not synced</small>
            <svg className="sparkline" viewBox="0 0 115 42" aria-hidden="true">
              <path
                d="M0 35L14 31L24 25L34 27L46 26L62 21L78 17L87 13L101 11L114 8L114 42L0 42Z"
                fill="#eaf6f5"
              />
              <path
                d="M0 35L14 31L24 25L34 27L46 26L62 21L78 17L87 13L101 11L114 8"
                stroke="#008b81"
                fill="none"
              />
            </svg>
          </div>
        ))}
      </div>
      {posts.length ? (
        <>
          <div className="report-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <ChartNoAxesCombined size={23} />
                  Reach trend
                </h2>
                <span className="chart-legend">
                  <i />
                  Current period
                </span>
              </div>
              <div
                className="chart-scroll"
                tabIndex={0}
                role="region"
                aria-label="Reach trend chart; scroll horizontally on smaller screens"
              >
                <svg
                  className="reach-chart"
                  viewBox="0 0 740 225"
                  role="img"
                  aria-label={`Weekly reach: ${weeks.join(", ")}`}
                >
                  <defs>
                    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#107578" stopOpacity=".16" />
                      <stop
                        offset="100%"
                        stopColor="#107578"
                        stopOpacity=".02"
                      />
                    </linearGradient>
                  </defs>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <g key={i}>
                      <line
                        x1="40"
                        x2="720"
                        y1={35 + i * 37.5}
                        y2={35 + i * 37.5}
                        stroke="#e7ebef"
                      />
                      <text x="8" y={39 + i * 37.5} textAnchor="start">
                        {Math.round((max * (4 - i)) / 4).toLocaleString()}
                      </text>
                    </g>
                  ))}
                  <polygon
                    points={`70,185 ${points} 670,185`}
                    fill="url(#chartFill)"
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke="#007576"
                    strokeWidth="3"
                  />
                  {weeks.map((n, i) => (
                    <g key={i}>
                      <circle
                        cx={70 + i * 200}
                        cy={185 - (n / max) * 150}
                        r="5"
                        fill="#007576"
                      />
                      <text
                        x={70 + i * 200}
                        y={170 - (n / max) * 150}
                        textAnchor="middle"
                        className="chart-value"
                      >
                        {n.toLocaleString()}
                      </text>
                      <text x={70 + i * 200} y="210" textAnchor="middle">
                        Sep {i * 7 + 1}–{i === 3 ? 30 : (i + 1) * 7}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <ChartNoAxesCombined size={23} />
                  Platform comparison
                </h2>
              </div>
              <div className="platform-bars">
                {["Instagram", "Facebook", "LinkedIn"].map((name) => {
                  const value = posts
                    .filter((p) => p.platform === name)
                    .reduce((n, p) => n + (p.metrics?.reach || 0), 0);
                  return (
                    <div className="platform-bar" key={name}>
                      <Platform name={name} />
                      <div className="bar-track">
                        <div
                          style={{
                            width: reach ? `${(value / reach) * 100}%` : "0%",
                          }}
                        />
                      </div>
                      <strong>{value.toLocaleString()}</strong>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          <div className="report-lower">
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <FileCheck2 size={22} />
                  Top performing content
                </h2>
                <button className="text-link" onClick={exportReport}>
                  View all
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Content</th>
                      <th>Platform</th>
                      <th>Reach</th>
                      <th>Engagement</th>
                      <th>Leads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...posts]
                      .sort(
                        (a, b) =>
                          (b.metrics?.reach || 0) - (a.metrics?.reach || 0),
                      )
                      .map((p, i) => (
                        <tr key={p.id}>
                          <td>
                            <div className="report-content">
                              <img
                                className="asset-preview"
                                src={`/media/mockup/${sourceImages[i % 4]}.png`}
                                alt="Sample report creative"
                              />
                              <div>
                                <strong>{p.title}</strong>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Platform name={p.platform} />
                          </td>
                          <td>{p.metrics?.reach.toLocaleString()}</td>
                          <td>
                            {p.metrics?.reach
                              ? (
                                  (p.metrics.engagements / p.metrics.reach) *
                                  100
                                ).toFixed(1) + "%"
                              : "—"}
                          </td>
                          <td>{p.metrics?.leads}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <Filter size={22} />
                  Lead outcomes
                </h2>
              </div>
              <div className="funnel">
                {(["New", "Qualified", "Contacted", "Won"] as const).map(
                  (stage) => {
                    const count = data.leads.filter(
                      (l) =>
                        clientMatch(l.clientId, clientId) && l.stage === stage,
                    ).length;
                    return (
                      <div className="funnel-row" key={stage}>
                        <div className="funnel-stage">{count}</div>
                        <div>
                          <strong>{stage}</strong>
                          <p>{count} leads</p>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </section>
            <div className="report-side">
              <section className="panel report-insight">
                <div className="panel-heading">
                  <h2>
                    <Sparkles size={19} />
                    AI insights
                  </h2>
                </div>
                <p>
                  Coffee behind-the-scenes posts drove the strongest engagement.
                  Test two more next month.
                </p>
                <Badge>Sample insight · AI not connected</Badge>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <Link2 size={18} />
                    Connected account
                  </h2>
                </div>
                <p>
                  {data.clients.find((c) => c.id === clientId)?.name ||
                    "All clients"}
                  <br />
                  Not connected · illustrative report
                </p>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    <CalendarDays size={18} />
                    Reporting period
                  </h2>
                </div>
                <p>
                  {new Date(period + "-01T12:00:00").toLocaleDateString(
                    "en-US",
                    { month: "short", year: "numeric" },
                  )}
                  <br />
                  {compare === "Previous period"
                    ? "Previous-period data not connected"
                    : "No comparison"}
                </p>
              </section>
            </div>
          </div>
        </>
      ) : (
        <section className="panel">
          <Empty title="No published content in this period">
            Choose September 2026 to explore the sample report. Live analytics
            will appear after social integrations are connected.
          </Empty>
        </section>
      )}
    </>
  );
}
