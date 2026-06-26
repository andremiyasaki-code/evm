import { useMemo, useRef, useState } from "react";
import { Download, FileVideo, ImageDown, ImagePlus, Shuffle } from "lucide-react";
import gsap from "gsap";

type Point = { x: number; y: number };
type Settings = {
  backgroundColor: string;
  foregroundColor: string;
  transparentBackground: boolean;
  filled: boolean;
  fontWeight: number;
  fontSize: number;
  strokeWidth: number;
  maskEnabled: boolean;
  maskScale: number;
};

const viewBox = { width: 1000, height: 760 };
const initialPoints: Point[] = [
  { x: 290, y: 190 },
  { x: 725, y: 145 },
  { x: 775, y: 560 },
  { x: 235, y: 625 },
];
const initialSettings: Settings = {
  backgroundColor: "#282d26", foregroundColor: "#f5f5f5", transparentBackground: false,
  filled: false, fontWeight: 400, fontSize: 32, strokeWidth: 3,
  maskEnabled: false, maskScale: 100,
};
const initialTexts = ["Estúdio", "Vinícius", "Macêdo"];

function polygonPath(points: Point[]) { return points.map((point) => `${point.x},${point.y}`).join(" "); }
function centroid(points: Point[]) {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
function pointInPolygon(point: Point, vertices: Point[]) {
  return vertices.reduce((inside, current, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const intersects = (current.y > point.y) !== (previous.y > point.y)
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    return intersects ? !inside : inside;
  }, false);
}
const colorOptions = [
  { label: "Moss Green", value: "#282d26" },
  { label: "Soft Orange", value: "#ecbe93" },
  { label: "Grey Blue", value: "#20262d" },
  { label: "Light Grey", value: "#f5f5f5" },
];

function estimateTextWidth(text: string, fontSize: number) {
  return Math.max(fontSize, text.length * (fontSize * 0.56 + 1));
}
function segmentIntersection(a: Point, b: Point, c: Point, d: Point) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const cross = r.x * s.y - r.y * s.x;
  if (Math.abs(cross) < 0.001) return null;
  const q = { x: c.x - a.x, y: c.y - a.y };
  const t = (q.x * s.y - q.y * s.x) / cross;
  const u = (q.x * r.y - q.y * r.x) / cross;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999 ? t : null;
}
function availableLength(points: Point[], edge: number, fromEnd: boolean) {
  const a = points[edge];
  const b = points[(edge + 1) % points.length];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  let closest = length;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    if (index === edge || (index + 1) % points.length === edge || index === (edge + 1) % points.length) return;
    const t = segmentIntersection(a, b, point, next);
    if (t !== null) closest = Math.min(closest, (fromEnd ? 1 - t : t) * length);
  });
  return closest;
}
function edgeLabel(edgeStart: Point, edgeEnd: Point, anchorAtEnd: boolean, points: Point[], fontSize: number, strokeWidth: number) {
  const anchor = anchorAtEnd ? edgeEnd : edgeStart;
  const edgeDx = edgeEnd.x - edgeStart.x;
  const edgeDy = edgeEnd.y - edgeStart.y;
  const edgeLength = Math.hypot(edgeDx, edgeDy) || 1;
  const tangent = { x: edgeDx / edgeLength, y: edgeDy / edgeLength };
  const leftNormal = { x: -tangent.y, y: tangent.x };
  const midpoint = { x: (edgeStart.x + edgeEnd.x) / 2, y: (edgeStart.y + edgeEnd.y) / 2 };
  const probe = 8;
  const leftIsInside = pointInPolygon(
    { x: midpoint.x + leftNormal.x * probe, y: midpoint.y + leftNormal.y * probe },
    points,
  );
  const rightIsInside = pointInPolygon(
    { x: midpoint.x - leftNormal.x * probe, y: midpoint.y - leftNormal.y * probe },
    points,
  );
  const center = centroid(points);
  const leftPointsAway = leftNormal.x * (midpoint.x - center.x) + leftNormal.y * (midpoint.y - center.y) > 0;
  const useLeftAsOutside = leftIsInside === rightIsInside ? leftPointsAway : !leftIsInside;
  const normal = useLeftAsOutside ? leftNormal : { x: -leftNormal.x, y: -leftNormal.y };
  const inset = 0;
  const safeOffset = fontSize * 0.58 + strokeWidth / 2 + 4;
  const anchorDirection = anchorAtEnd ? -1 : 1;
  const position = {
    x: anchor.x + tangent.x * inset * anchorDirection + normal.x * safeOffset,
    y: anchor.y + tangent.y * inset * anchorDirection + normal.y * safeOffset,
  };

  const baseAngle = (Math.atan2(edgeDy, edgeDx) * 180) / Math.PI;
  const lowerSideFacesLine = leftNormal.x * -normal.x + leftNormal.y * -normal.y > 0;
  const angle = lowerSideFacesLine ? baseAngle : baseAngle + 180;
  const advance = lowerSideFacesLine ? tangent : { x: -tangent.x, y: -tangent.y };
  const intoSegment = anchorAtEnd ? { x: -tangent.x, y: -tangent.y } : tangent;
  const textAnchor = advance.x * intoSegment.x + advance.y * intoSegment.y > 0 ? "start" as const : "end" as const;
  return { ...position, angle, tangent: advance, textAnchor };
}
function assignLabels(points: Point[], texts: string[], fontSize: number, strokeWidth: number) {
  type Candidate = { textIndex: number; edge: number; fromEnd: boolean; clearance: number; width: number; label: ReturnType<typeof edgeLabel> };
  const candidates = texts.map((text, textIndex) => [0, 1, 2, 3].flatMap((edge) => [false, true].flatMap((fromEnd) => {
    const clearance = availableLength(points, edge, fromEnd);
    const width = estimateTextWidth(text, fontSize);
    const needed = width + 18;
    if (clearance < needed) return [];
    return [{ textIndex, edge, fromEnd, clearance, width, label: edgeLabel(points[edge], points[(edge + 1) % points.length], fromEnd, points, fontSize, strokeWidth) }];
  })));
  let best: Candidate[] = [];
  const span = (candidate: Candidate) => candidate.label.textAnchor === "start" ? ({
    start: { x: candidate.label.x, y: candidate.label.y },
    end: { x: candidate.label.x + candidate.label.tangent.x * candidate.width, y: candidate.label.y + candidate.label.tangent.y * candidate.width },
  }) : ({
    start: { x: candidate.label.x - candidate.label.tangent.x * candidate.width, y: candidate.label.y - candidate.label.tangent.y * candidate.width },
    end: { x: candidate.label.x, y: candidate.label.y },
  });
  const intersectsLabel = (first: Candidate, second: Candidate) => {
    const firstSpan = span(first);
    const secondSpan = span(second);
    return segmentIntersection(firstSpan.start, firstSpan.end, secondSpan.start, secondSpan.end) !== null;
  };
  const intersectsLine = (candidate: Candidate) => {
    const candidateSpan = span(candidate);
    return points.some((point, index) => {
      if (index === candidate.edge) return false;
      return segmentIntersection(candidateSpan.start, candidateSpan.end, point, points[(index + 1) % points.length]) !== null;
    });
  };
  const score = (items: Candidate[]) => items.reduce((total, item) => total + item.clearance - item.width, 0);
  const choose = (index: number, used: Set<number>, selected: Candidate[]) => {
    if (index === candidates.length) { if (!best.length || score(selected) > score(best)) best = selected; return; }
    candidates[index].forEach((candidate) => { if (!used.has(candidate.edge) && !intersectsLine(candidate) && !selected.some((item) => intersectsLabel(item, candidate))) { used.add(candidate.edge); choose(index + 1, used, [...selected, candidate]); used.delete(candidate.edge); } });
  };
  choose(0, new Set(), []);
  return best.length === texts.length ? best.sort((a, b) => a.textIndex - b.textIndex) : [];
}
function randomPoint(minX: number, maxX: number, minY: number, maxY: number) {
  return { x: Math.round(minX + Math.random() * (maxX - minX)), y: Math.round(minY + Math.random() * (maxY - minY)) };
}
function randomShape(texts: string[], fontSize: number, strokeWidth: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const regular = [randomPoint(145, 390, 95, 285), randomPoint(610, 860, 100, 305), randomPoint(600, 860, 455, 670), randomPoint(140, 400, 450, 680)];
    const candidate = Math.random() < 0.42 ? [regular[0], regular[2], regular[1], regular[3]] : regular;
    if (assignLabels(candidate, texts, fontSize, strokeWidth).length === texts.length) return candidate;
  }
  return null;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
function escapeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function controlId(label: string) { return label.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }

export default function App() {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [texts, setTexts] = useState<string[]>(initialTexts);
  const [maskImage, setMaskImage] = useState("");
  const [maskPosition, setMaskPosition] = useState({ x: 0, y: 0 });
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [draggingMask, setDraggingMask] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const maskId = "polygon-image-mask";
  const labels = useMemo(() => assignLabels(points, texts, settings.fontSize, settings.strokeWidth), [points, texts, settings.fontSize, settings.strokeWidth]);

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const svgPointFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current; if (!svg) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: Math.min(viewBox.width - 24, Math.max(24, transformed.x)), y: Math.min(viewBox.height - 24, Math.max(24, transformed.y)) };
  };
  const movePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const next = svgPointFromEvent(event); if (!next) return;
    if (activePoint !== null) setPoints((current) => {
      const candidate = current.map((point, index) => index === activePoint ? next : point);
      return assignLabels(candidate, texts, settings.fontSize, settings.strokeWidth).length === texts.length ? candidate : current;
    });
    if (draggingMask) setMaskPosition((current) => ({ x: current.x + event.movementX, y: current.y + event.movementY }));
  };
  const randomizeShape = () => {
    const target = randomShape(texts, settings.fontSize, settings.strokeWidth); if (!target) return; const start = points.map((point) => ({ ...point })); const proxy = { progress: 0 };
    gsap.to(proxy, { progress: 1, duration: 1.05, ease: "power3.out", onUpdate: () => setPoints(start.map((point, index) => ({ x: point.x + (target[index].x - point.x) * proxy.progress, y: point.y + (target[index].y - point.y) * proxy.progress }))), onComplete: () => setPoints(target) });
  };
  const labelsFor = (renderPoints: Point[]) => assignLabels(renderPoints, texts, settings.fontSize, settings.strokeWidth);
  const renderMarkup = (renderPoints: Point[]) => {
    const renderLabels = labelsFor(renderPoints); const stroke = settings.strokeWidth === 0 ? "transparent" : settings.foregroundColor;
    const imageSize = settings.maskScale * 10;
    const background = settings.transparentBackground ? "" : `<rect width="100%" height="100%" fill="${settings.backgroundColor}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox.width}" height="${viewBox.height}" viewBox="0 0 ${viewBox.width} ${viewBox.height}"><defs><clipPath id="${maskId}"><polygon points="${polygonPath(renderPoints)}" /></clipPath></defs>${background}<polygon points="${polygonPath(renderPoints)}" fill="${settings.filled ? settings.foregroundColor : "transparent"}" stroke="${stroke}" stroke-width="${settings.strokeWidth}" stroke-linejoin="round"/>${renderLabels.map((assignment) => texts[assignment.textIndex] ? `<text x="${assignment.label.x}" y="${assignment.label.y}" fill="${settings.foregroundColor}" font-family="PP Neue Montreal, Inter, Arial, sans-serif" font-weight="${settings.fontWeight}" font-size="${settings.fontSize}" letter-spacing="1" text-anchor="${assignment.label.textAnchor}" dominant-baseline="middle" transform="rotate(${assignment.label.angle} ${assignment.label.x} ${assignment.label.y})">${escapeXml(texts[assignment.textIndex])}</text>` : "").join("")}${settings.maskEnabled && maskImage ? `<image href="${maskImage}" x="${maskPosition.x + (viewBox.width - imageSize) / 2}" y="${maskPosition.y + (viewBox.height - imageSize) / 2}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${maskId})"/>` : ""}</svg>`;
  };
  const svgMarkup = () => renderMarkup(points);
  const exportSvg = () => downloadBlob(new Blob([svgMarkup()], { type: "image/svg+xml" }), "polygon-identity.svg");
  const exportPng = async () => {
    const image = new Image(); const url = URL.createObjectURL(new Blob([svgMarkup()], { type: "image/svg+xml" })); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = viewBox.width * 2; canvas.height = viewBox.height * 2; const context = canvas.getContext("2d"); if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); canvas.toBlob((blob) => blob && downloadBlob(blob, "polygon-identity.png"), "image/png");
  };
  const exportMp4 = async () => {
    const canvas = document.createElement("canvas"); canvas.width = viewBox.width; canvas.height = viewBox.height; const context = canvas.getContext("2d"); if (!context) return;
    const stream = canvas.captureStream(30); const mimeType = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm"; const chunks: Blob[] = []; const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data); recorder.onstop = () => downloadBlob(new Blob(chunks, { type: mimeType }), `polygon-identity.${mimeType.includes("mp4") ? "mp4" : "webm"}`);
    const start = points.map((point) => ({ ...point })); const target = randomShape(texts, settings.fontSize, settings.strokeWidth) ?? points; const startedAt = performance.now();
    const draw = async (framePoints: Point[]) => { const image = new Image(); const url = URL.createObjectURL(new Blob([renderMarkup(framePoints)], { type: "image/svg+xml" })); image.src = url; await image.decode(); context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); URL.revokeObjectURL(url); };
    recorder.start(); const frame = async (time: number) => { const progress = Math.min(1, (time - startedAt) / 1800); const eased = 1 - Math.pow(1 - progress, 3); await draw(start.map((point, index) => ({ x: point.x + (target[index].x - point.x) * eased, y: point.y + (target[index].y - point.y) * eased }))); if (progress < 1) requestAnimationFrame(frame); else { setPoints(target); window.setTimeout(() => recorder.stop(), 250); } }; requestAnimationFrame(frame);
  };
  const control = (label: string, input: React.ReactNode) => <label className="control" htmlFor={controlId(label)}><span>{label}</span>{input}</label>;
  const uploadMask = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setMaskImage(String(reader.result)); reader.readAsDataURL(file); };

  return <main className="app" style={{ background: settings.backgroundColor }}><aside className="panel"><div className="panel-heading"><p>Estúdio Vinícius Macêdo</p><span>SVG generator</span></div>
    <section><h2>Shape</h2><label className="toggle"><input type="checkbox" checked={settings.filled} onChange={(event) => updateSetting("filled", event.target.checked)} /><span>Fill Shape</span></label>{control("Stroke Width", <input id="stroke-width" type="range" min="0" max="3" value={settings.strokeWidth} onChange={(event) => updateSetting("strokeWidth", Number(event.target.value))} />)}</section>
    <section><h2>Typography</h2>{control("Font Weight", <input id="font-weight" type="number" min="300" max="500" step="100" value={settings.fontWeight} onChange={(event) => updateSetting("fontWeight", Number(event.target.value))} />)}{control("Font Size", <input id="font-size" type="number" min="30" max="40" value={settings.fontSize} onChange={(event) => updateSetting("fontSize", Number(event.target.value))} />)}</section>
    <section><h2>Colors</h2>{control("Background Color", <select id="background-color" value={settings.backgroundColor} onChange={(event) => updateSetting("backgroundColor", event.target.value)}>{colorOptions.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select>)}<label className="toggle"><input type="checkbox" checked={settings.transparentBackground} onChange={(event) => updateSetting("transparentBackground", event.target.checked)} /><span>Transparent PNG Background</span></label>{control("Identity Color", <select id="identity-color" value={settings.foregroundColor} onChange={(event) => updateSetting("foregroundColor", event.target.value)}>{colorOptions.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}</select>)}</section>
    <section><h2>Texts</h2>{texts.map((text, index) => <div key={index}>{control(`Texto ${index + 1}`, <input id={`texto-${index + 1}`} value={text} onChange={(event) => setTexts((current) => current.map((value, textIndex) => textIndex === index ? event.target.value : value))} />)}</div>)}</section>
    <section><h2>Image Mask</h2><label className="toggle"><input type="checkbox" checked={settings.maskEnabled} onChange={(event) => updateSetting("maskEnabled", event.target.checked)} /><span>Enable Mask Layer</span></label><label className="icon-button file-input" title={maskImage ? "Replace Image" : "Add Image"} aria-label={maskImage ? "Replace Image" : "Add Image"}><ImagePlus size={12} /><span>{maskImage ? "Replace Image" : "Add Image"}</span><input type="file" accept="image/*" onChange={uploadMask} /></label>{control("Mask Scale", <input id="mask-scale" type="range" min="50" max="180" value={settings.maskScale} onChange={(event) => updateSetting("maskScale", Number(event.target.value))} />)}</section>
    <section><h2>Motion</h2><button className="icon-button action" onClick={randomizeShape} title="Randomize Shape" aria-label="Randomize Shape"><Shuffle size={12} /><span>Randomize Shape</span></button></section>
    <section className="exports"><h2>Export</h2><button className="icon-button" onClick={exportSvg} title="Export SVG" aria-label="Export SVG"><Download size={12} /><span>Export SVG</span></button><button className="icon-button" onClick={exportPng} title="Export PNG" aria-label="Export PNG"><ImageDown size={12} /><span>Export PNG</span></button><button className="icon-button" onClick={exportMp4} title="Export MP4" aria-label="Export MP4"><FileVideo size={12} /><span>Export MP4</span></button></section>
  </aside><section className="stage"><svg ref={svgRef} viewBox={`0 0 ${viewBox.width} ${viewBox.height}`} role="img" aria-label="Dynamic polygon identity" onPointerMove={movePointer} onPointerUp={() => { setActivePoint(null); setDraggingMask(false); }} onPointerLeave={() => { setActivePoint(null); setDraggingMask(false); }} style={{ background: settings.transparentBackground ? "transparent" : settings.backgroundColor }}><defs><clipPath id={maskId}><polygon points={polygonPath(points)} /></clipPath></defs><polygon points={polygonPath(points)} fill={settings.filled ? settings.foregroundColor : "transparent"} stroke={settings.strokeWidth === 0 ? "transparent" : settings.foregroundColor} strokeWidth={settings.strokeWidth} strokeLinejoin="round" />{labels.map((assignment) => texts[assignment.textIndex] && <text key={`${assignment.textIndex}-${texts[assignment.textIndex]}`} x={assignment.label.x} y={assignment.label.y} fill={settings.foregroundColor} fontFamily="PP Neue Montreal, Inter, Arial, sans-serif" fontWeight={settings.fontWeight} fontSize={settings.fontSize} letterSpacing="1" textAnchor={assignment.label.textAnchor} dominantBaseline="middle" transform={`rotate(${assignment.label.angle} ${assignment.label.x} ${assignment.label.y})`}>{texts[assignment.textIndex]}</text>)}{settings.maskEnabled && maskImage && <image href={maskImage} x={maskPosition.x + (viewBox.width - settings.maskScale * 10) / 2} y={maskPosition.y + (viewBox.height - settings.maskScale * 10) / 2} width={settings.maskScale * 10} height={settings.maskScale * 10} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${maskId})`} className="mask-image" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDraggingMask(true); }} />}{points.map((point, index) => <g key={index} className="vertex-handle"><circle cx={point.x} cy={point.y} r="15" className="handle-hit" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setActivePoint(index); }} /><circle cx={point.x} cy={point.y} r="5.5" className="handle-dot" /></g>)}</svg></section></main>;
}
