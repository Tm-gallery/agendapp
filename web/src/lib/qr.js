// QR codes for device-to-device transfer: drawing (qrcode-generator) and reading (jsQR).
import jsQR from "jsqr";
import qrcode from "qrcode-generator";

/** Draws `text` as a QR code in `canvas`, about `size` CSS pixels wide (sharp on high-DPI screens). */
export function drawQr(canvas, text, size = 300) {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const modules = qr.getModuleCount();
  const margin = 4; // quiet zone required by the standard, in modules
  const cells = modules + margin * 2;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const scale = Math.max(2, Math.floor((size * ratio) / cells));
  const px = scale * cells;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000";
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
  }
}

/** Text of the QR code found in an image (ImageData), or null. */
export function decodeQr(image) {
  return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data || null;
}

/** Reads a QR code from a photo, trying several sizes (large photos sometimes fail). */
export async function decodeQrImage(file) {
  const bitmap = await createImageBitmap(file);
  for (const maxSide of [1600, 1000, 640]) {
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const text = decodeQr(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (text) {
      return text;
    }
  }
  return null;
}
