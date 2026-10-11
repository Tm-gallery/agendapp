// Settings › Transfer: send (cycling QR codes, text code) and receive (camera, photo, paste).
import { useState, useRef, useEffect } from "preact/hooks";
import { t } from "../../i18n/index.js";
import { addDays, todayIso } from "../../lib/dates.js";
import { haptic } from "../../lib/haptics.js";
import { getHost, saveFile } from "../../lib/host.js";
import { deviceSettings, normalizeState } from "../../lib/model.js";
import { decodeQr, decodeQrImage, drawQr } from "../../lib/qr.js";
import { getState, undo, updateState, useAppState } from "../../lib/store.js";
import {
  chunkCollector,
  compareStates,
  decodeTransfer,
  encodeTransfer,
  mergeStates,
  splitIntoChunks,
  transferPayload,
} from "../../lib/transfer.js";
import { Icon } from "../../ui/Icon.jsx";
import { confirmDialog, toast } from "../../ui/Overlays.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import { Button, EmptyState, ListItem, Segmented } from "../../ui/components.jsx";

function TransferSendSheet({ onClose }) {
  const state = useAppState();
  const [scope, setScope] = useState("all");
  const [code, setCode] = useState("");
  const [chunks, setChunks] = useState([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState("qr");
  const canvasRef = useRef(null);
  useEffect(() => {
    let active = true;
    const since = scope === "recent" ? addDays(todayIso(), -31) : null;
    encodeTransfer(transferPayload(getState(), { since })).then((text) => {
      if (active) {
        setCode(text);
        setChunks(splitIntoChunks(text));
        setIndex(0);
      }
    });
    return () => {
      active = false;
    };
  }, [scope]);
  useEffect(() => {
    if (!playing || chunks.length < 2) {
      return;
    }
    const timer = setInterval(() => setIndex((prev) => (prev + 1) % chunks.length), 450);
    return () => clearInterval(timer);
  }, [playing, chunks]);
  useEffect(() => {
    if (view === "qr" && canvasRef.current && chunks[index]) {
      drawQr(canvasRef.current, chunks[index]);
    }
  }, [chunks, index, view]);
  useEffect(() => {
    let lock = null;
    navigator.wakeLock
      ?.request?.("screen")
      .then((sentinel) => {
        lock = sentinel;
      })
      .catch(() => {});
    return () => {
      lock?.release?.().catch(() => {});
    };
  }, []);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast(t("transfer.copied"));
    } catch {
      setView("text");
      toast(t("transfer.copyFailed"));
    }
  };
  const saveCode = async () => {
    try {
      const result = await saveFile(await getHost(), {
        filename: "agendapp-transfer.txt",
        data: code,
        mime: "text/plain",
      });
      if (result === "saved") {
        toast(t("transfer.saved"));
      } else if (result === "unsupported") {
        toast(t("transfer.saveUnsupported"));
      }
    } catch (err) {
      toast(t("common.failed", { error: err?.message || err?.code }), { tone: "danger" });
    }
  };
  const eventCount =
    scope === "recent"
      ? state.events.filter((ev) => ev.date >= addDays(todayIso(), -31)).length
      : state.events.length;
  const sizeKb = Math.max(1, Math.round(code.length / 1024));
  return (
    <Sheet
      onClose={onClose}
      title={t("transfer.sendTitle")}
      subtitle={t("transfer.sendSub", { events: t("common.events", { n: eventCount }) })}
    >
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { v: "all", label: t("transfer.scope.all"), sub: t("transfer.scope.allSub") },
          { v: "recent", label: t("transfer.scope.recent"), sub: t("transfer.scope.recentSub") },
        ]}
      />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { v: "qr", label: t("transfer.view.qr") },
          { v: "text", label: t("transfer.view.text") },
        ]}
      />
      {view === "qr" ? (
        <div class="tr-qr">
          {chunks.length ? (
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={t("transfer.qrLabel", { i: index + 1, n: chunks.length })}
            />
          ) : (
            <div class="tr-wait">{t("transfer.preparing")}</div>
          )}
          <div class="tr-bar">
            <button
              type="button"
              class="ibtn"
              aria-label={t("transfer.prevImage")}
              disabled={chunks.length < 2}
              onClick={() => {
                setPlaying(false);
                setIndex((prev) => (prev - 1 + chunks.length) % chunks.length);
              }}
            >
              <Icon n="chevL" size={20} />
            </button>
            <button
              type="button"
              class="ibtn"
              aria-label={t(playing ? "transfer.pause" : "transfer.play")}
              disabled={chunks.length < 2}
              onClick={() => setPlaying((prev) => !prev)}
            >
              <Icon n={playing ? "pause" : "play"} size={20} />
            </button>
            <button
              type="button"
              class="ibtn"
              aria-label={t("transfer.nextImage")}
              disabled={chunks.length < 2}
              onClick={() => {
                setPlaying(false);
                setIndex((prev) => (prev + 1) % chunks.length);
              }}
            >
              <Icon n="chevR" size={20} />
            </button>
          </div>
          <p class="tr-n">{chunks.length ? t("transfer.imageOf", { i: index + 1, n: chunks.length }) : ""}</p>
          <p class="muted small">{t("transfer.qrHint")}</p>
        </div>
      ) : (
        <div class="blk">
          <textarea
            class="inp tr-code"
            readonly={true}
            rows={6}
            value={code}
            aria-label={t("transfer.code")}
            onFocus={(ev) => ev.currentTarget.select()}
          />
          <p class="muted small">{t("transfer.textHint", { kb: sizeKb })}</p>
        </div>
      )}
      <div class="row gap-s wrap">
        <Button icon="copy" onClick={copyCode} disabled={!code}>
          {t("transfer.copy")}
        </Button>
        <Button icon="download" onClick={saveCode} disabled={!code}>
          {t("common.save")}
        </Button>
      </div>
    </Sheet>
  );
}

function QrScanner({ onText, onUnavailable }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState(() => t("transfer.cameraStarting"));
  useEffect(() => {
    let stopped = false;
    let stream = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("unavailable");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
          },
          audio: false,
        });
        if (stopped) {
          return stream.getTracks().forEach((track) => track.stop());
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setStatus(t("transfer.aim"));
        let lastScan = 0;
        const tick = (time) => {
          if (
            stopped ||
            ((raf = requestAnimationFrame(tick)),
            time - lastScan < 90 || video.readyState < 2 || !video.videoWidth)
          ) {
            return;
          }
          lastScan = time;
          const ratio = Math.min(1, 800 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * ratio);
          canvas.height = Math.round(video.videoHeight * ratio);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const text = decodeQr(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (text) {
            onText(text);
          }
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (!stopped) {
          onUnavailable(
            t(err?.name === "NotAllowedError" ? "transfer.cameraDenied" : "transfer.cameraUnavailable"),
          );
        }
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <div class="tr-cam">
      <video ref={videoRef} muted={true} playsInline={true} />
      <i class="tr-frame" />
      <p>{status}</p>
    </div>
  );
}

function TransferReceiveSheet({ onClose }) {
  const state = useAppState();
  const [source, setSource] = useState("scan");
  const [cameraError, setCameraError] = useState("");
  const [pasted, setPasted] = useState("");
  const [progress, setProgress] = useState({ got: 0, total: 0 });
  const [received, setReceived] = useState(null);
  const [reading, setReading] = useState(false);
  const [mode, setMode] = useState("merge");
  const collector = useRef(chunkCollector());
  const fileRef = useRef(null);
  const busy = useRef(false);
  const readCode = async (code) => {
    if (!busy.current) {
      busy.current = true;
      try {
        const data = await decodeTransfer(code);
        haptic(18);
        setReceived(data);
      } catch (err) {
        busy.current = false;
        collector.current.reset();
        setProgress({ got: 0, total: 0 });
        toast(t("transfer.receiveFailed", { error: err.message }), { tone: "danger" });
      }
    }
  };
  const onScan = (text) => {
    if (busy.current) {
      return;
    }
    if (/^PAMX1:/.test(text.trim())) {
      return readCode(text);
    }
    const res = collector.current.add(text);
    if (res.ok) {
      if (res.isNew) {
        haptic(5);
      }
      setProgress({ got: res.got, total: res.total });
      if (res.done) {
        readCode(collector.current.code());
      }
    }
  };
  const readPasted = async () => {
    setReading(true);
    await readCode(pasted);
    setReading(false);
  };
  const readPhotos = async (files) => {
    for (const file of files) {
      try {
        const text = await decodeQrImage(file);
        if (text) {
          onScan(text);
        } else {
          toast(t("transfer.noQrInPhoto"));
        }
      } catch {
        toast(t("transfer.badImage"), { tone: "danger" });
      }
    }
  };
  const apply = () => {
    const keep = deviceSettings(getState().settings);
    updateState(
      (prev) =>
        mode === "replace"
          ? normalizeState({
              ...received,
              settings: { ...received.settings, ...keep },
            })
          : mergeStates(prev, received),
      { label: t("undo.transfer") },
    );
    toast(t(mode === "replace" ? "transfer.replaced" : "transfer.merged"), {
      action: { label: t("common.undo"), run: undo },
    });
    onClose();
  };
  if (received) {
    const summary = compareStates(state, received);
    const upToDate = !summary.added && !summary.newer && !summary.removedHere && !summary.configNewer;
    return (
      <Sheet
        onClose={onClose}
        title={t("transfer.received")}
        subtitle={`${t("common.events", { n: received.events.length })} · ${t("transfer.types", { n: received.types.length })}`}
        footer={
          <Button
            kind={mode === "replace" ? "danger" : "primary"}
            block={true}
            onClick={async () => {
              if (
                !(
                  mode === "replace" &&
                  !(await confirmDialog({
                    title: t("data.replaceTitle"),
                    text: t("transfer.replaceText"),
                    confirmLabel: t("data.replace"),
                    danger: true,
                  }))
                )
              ) {
                apply();
              }
            }}
          >
            {mode === "replace" ? t("data.replace") : upToDate ? t("transfer.upToDate") : t("transfer.merge")}
          </Button>
        }
      >
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { v: "merge", label: t("transfer.merge"), sub: t("transfer.mergeSub") },
            { v: "replace", label: t("data.replace"), sub: t("transfer.replaceSub") },
          ]}
        />
        {mode === "merge" ? (
          <div class="tr-sum">
            {["added", "newer", "removedHere", "same"].map((key) => (
              <div key={key}>
                <b>{summary[key]}</b>
                <span>{t(`transfer.sum.${key}`, { n: summary[key] })}</span>
              </div>
            ))}
          </div>
        ) : (
          <p class="muted small">
            <Icon n="alert" size={14} />{" "}
            {t("transfer.replaceWarning", { local: summary.localEvents, incoming: summary.incomingEvents })}
          </p>
        )}
        <p class="muted small">
          {mode === "merge"
            ? `${t("transfer.mergeHint")} ${t(summary.configNewer ? "transfer.configNewer" : "transfer.configKept")}`
            : t("transfer.replaceHint")}
        </p>
      </Sheet>
    );
  }
  return (
    <Sheet onClose={onClose} title={t("transfer.receiveTitle")} subtitle={t("transfer.receiveSub")}>
      <Segmented
        value={source}
        onChange={setSource}
        options={[
          { v: "scan", label: t("transfer.source.scan") },
          { v: "photo", label: t("transfer.source.photo") },
          { v: "text", label: t("transfer.source.paste") },
        ]}
      />
      {source === "scan" &&
        (cameraError ? (
          <EmptyState
            icon="camera"
            title={cameraError}
            text={t("transfer.cameraFallback")}
          />
        ) : (
          <QrScanner onText={onScan} onUnavailable={setCameraError} />
        ))}
      {source === "photo" && (
        <div class="blk">
          <p class="muted small">{t("transfer.photoHint")}</p>
          <Button block={true} icon="camera" onClick={() => fileRef.current?.click()}>
            {t("transfer.takePhoto")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple={true}
            hidden={true}
            onChange={(ev) => {
              readPhotos([...ev.currentTarget.files]);
              ev.currentTarget.value = "";
            }}
          />
        </div>
      )}
      {source === "text" && (
        <div class="blk">
          <textarea
            id="tr-paste"
            class="inp tr-code"
            rows={6}
            placeholder={t("transfer.pastePlaceholder")}
            value={pasted}
            onInput={(ev) => setPasted(ev.currentTarget.value)}
          />
          <Button kind="primary" block={true} disabled={!pasted.trim() || reading} onClick={readPasted}>
            {t("transfer.readCode")}
          </Button>
        </div>
      )}
      {progress.total > 0 && source !== "text" && (
        <div class="tr-prog" role="status">
          <i
            style={{
              width: `${(progress.got / progress.total) * 100}%`,
            }}
          />
          <span>{t("transfer.progress", { got: progress.got, total: progress.total })}</span>
        </div>
      )}
    </Sheet>
  );
}

export function TransferPage({ onBack, Back }) {
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  return (
    <div class="page">
      <Back title={t("settings.transfer")} onBack={onBack} />
      <div class="scroll">
        <p class="lead">{t("transfer.lead")}</p>
        <div class="stack">
          <ListItem
            class="big"
            left={
              <span class="li-ico">
                <Icon n="qr" size={20} />
              </span>
            }
            title={t("transfer.send")}
            sub={t("transfer.sendHint")}
            onClick={() => setSending(true)}
          />
          <ListItem
            class="big"
            left={
              <span class="li-ico">
                <Icon n="camera" size={20} />
              </span>
            }
            title={t("transfer.receive")}
            sub={t("transfer.receiveHint")}
            onClick={() => setReceiving(true)}
          />
        </div>
        <p class="muted small">{t("transfer.footer1")}</p>
        <p class="muted small">{t("transfer.footer2")}</p>
      </div>
      {sending && <TransferSendSheet onClose={() => setSending(false)} />}
      {receiving && <TransferReceiveSheet onClose={() => setReceiving(false)} />}
    </div>
  );
}
