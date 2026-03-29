import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

function getBengaliFont(): Buffer | null {
  // Full TTF bundled with the project (covers all Bengali glyphs)
  const bundled = path.join(__dirname, "..", "fonts", "NotoSansBengali-Regular.ttf");
  try {
    const buf = fs.readFileSync(bundled);
    return buf;
  } catch {
    console.error("[getBengaliFont] Bundled font not found at:", bundled);
    return null;
  }
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};

export async function generateInvoicePdf(
  order: any,
  type: "admin" | "user"
): Promise<Buffer> {
  const bengaliFont = getBengaliFont();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Register Bengali font if available
    const BENGALI = "NotoSansBengali";
    if (bengaliFont) {
      doc.registerFont(BENGALI, bengaliFont);
    }

    // Helper: use Bengali font for data fields that may contain Bengali text
    const dataFont = (size = 9) => {
      if (bengaliFont) doc.font(BENGALI).fontSize(size);
      else doc.font("Helvetica").fontSize(size);
      return doc;
    };

    const dark = "#1a1a2e";
    const gold = "#d4a017";
    const gray = "#6b7280";
    const light = "#f9fafb";

    const subtotal = (order.pricePerKit ?? 0) * (order.quantity ?? 0);
    const date = new Date(order.orderDate || order.createdAt).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // ── Header Band ─────────────────────────────────────────────
    doc.rect(50, 50, 495, 70).fill(dark);

    doc.fillColor(gold).fontSize(18).font("Helvetica-Bold")
      .text("MAGGOT-FREE RESCUE KIT", 65, 65);
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica")
      .text("Maggot-Free Rescue Kit | Bangladesh", 65, 87);

    doc.fillColor(gold).fontSize(26).font("Helvetica-Bold")
      .text("INVOICE", 370, 63, { width: 160, align: "right" });
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica")
      .text(`# ${order.orderId}`, 370, 95, { width: 160, align: "right" });

    // ── Date & Status row ────────────────────────────────────────
    doc.fillColor(gray).fontSize(9).font("Helvetica")
      .text(`Date: ${date}`, 50, 135)
      .text(`Status: ${STATUS_LABELS[order.status] ?? order.status}`, 50, 150);

    if (type === "admin") {
      doc.text(`Payment: Cash on Delivery`, 50, 165);
    }

    // ── Bill To box ─────────────────────────────────────────────
    const billY = type === "admin" ? 195 : 180;
    doc.rect(50, billY, 495, type === "admin" ? 105 : 106).fill(light);
    doc.rect(50, billY, 495, 18).fill("#e5e7eb");

    doc.fillColor(dark).fontSize(8).font("Helvetica-Bold")
      .text("BILL TO", 62, billY + 5);

    let infoY = billY + 26;
    const lineH = 16;

    // Name
    doc.fillColor(gray).font("Helvetica").fontSize(9).text("Name:", 62, infoY);
    dataFont(9).fillColor(dark).text(order.name, 130, infoY);
    infoY += lineH;

    // Email (both admin and user)
    if (order.email) {
      doc.fillColor(gray).font("Helvetica").fontSize(9).text("Email:", 62, infoY);
      doc.fillColor(dark).font("Helvetica").fontSize(9).text(order.email, 130, infoY);
      infoY += lineH;
    }

    if (type === "admin") {
      // Phone
      doc.fillColor(gray).font("Helvetica").fontSize(9).text("Phone:", 62, infoY);
      doc.fillColor(dark).font("Helvetica").fontSize(9).text(order.phone, 130, infoY);
      infoY += lineH;
    }

    // District (may be Bengali)
    doc.fillColor(gray).font("Helvetica").fontSize(9).text("District:", 62, infoY);
    dataFont(9).fillColor(dark).text(order.district, 130, infoY);
    infoY += lineH;

    // Area (English)
    doc.fillColor(gray).font("Helvetica").fontSize(9).text("Area:", 62, infoY);
    doc.fillColor(dark).font("Helvetica").fontSize(9)
      .text(order.insideDhaka ? "Inside Dhaka" : "Outside Dhaka", 130, infoY);
    infoY += lineH;

    // Address (may be Bengali)
    doc.fillColor(gray).font("Helvetica").fontSize(9).text("Address:", 62, infoY);
    dataFont(9).fillColor(dark).text(order.address, 130, infoY, { width: 400 });

    // ── Items Table ─────────────────────────────────────────────
    const tableY = billY + (type === "admin" ? 120 : 124);

    // Header row
    doc.rect(50, tableY, 495, 22).fill(dark);
    doc.fillColor(gold).fontSize(8).font("Helvetica-Bold")
      .text("DESCRIPTION", 62, tableY + 7)
      .text("QTY", 340, tableY + 7, { width: 40, align: "right" })
      .text("UNIT PRICE", 390, tableY + 7, { width: 70, align: "right" })
      .text("AMOUNT", 465, tableY + 7, { width: 70, align: "right" });

    // Row 1 — Kit
    const row1Y = tableY + 22;
    doc.rect(50, row1Y, 495, 22).fill("#ffffff");
    doc.fillColor(dark).fontSize(9).font("Helvetica")
      .text("Maggot-Free Rescue Kit", 62, row1Y + 6)
      .text(`${order.quantity}`, 340, row1Y + 6, { width: 40, align: "right" })
      .text(`BDT ${order.pricePerKit?.toLocaleString()}`, 390, row1Y + 6, { width: 70, align: "right" })
      .text(`BDT ${subtotal?.toLocaleString()}`, 465, row1Y + 6, { width: 70, align: "right" });

    // Row 2 — Delivery
    const row2Y = row1Y + 22;
    doc.rect(50, row2Y, 495, 22).fill(light);
    doc.fillColor(dark).fontSize(9).font("Helvetica")
      .text("Delivery Charge", 62, row2Y + 6)
      .text("—", 340, row2Y + 6, { width: 40, align: "right" })
      .text("—", 390, row2Y + 6, { width: 70, align: "right" })
      .text(`BDT ${order.deliveryFee?.toLocaleString()}`, 465, row2Y + 6, { width: 70, align: "right" });

    // ── Totals ──────────────────────────────────────────────────
    let totY = row2Y + 36;
    const totX = 350;

    const gross = subtotal + (order.deliveryFee ?? 0);

    doc.fillColor(gray).fontSize(9).font("Helvetica")
      .text("Subtotal:", totX, totY, { width: 100 })
      .fillColor(dark).font("Helvetica-Bold")
      .text(`BDT ${gross?.toLocaleString()}`, totX + 100, totY, { width: 95, align: "right" });
    totY += 18;

    if (order.couponCode && order.discountAmount) {
      doc.fillColor("#16a34a").fontSize(9).font("Helvetica")
        .text(`Discount (${order.couponCode}):`, totX, totY, { width: 100 })
        .font("Helvetica-Bold")
        .text(`-BDT ${order.discountAmount?.toLocaleString()}`, totX + 100, totY, { width: 95, align: "right" });
      totY += 18;
    }

    // Total row
    doc.rect(totX - 5, totY, 200, 26).fill(dark);
    doc.fillColor(gold).fontSize(11).font("Helvetica-Bold")
      .text("TOTAL (COD):", totX + 2, totY + 7, { width: 100 })
      .text(`BDT ${order.totalPrice?.toLocaleString()}`, totX + 100, totY + 7, { width: 93, align: "right" });

    // ── Admin note ───────────────────────────────────────────────
    if (type === "admin" && order.note) {
      const noteY = totY + 42;
      doc.rect(50, noteY, 495, 28).fill("#fffbeb");
      doc.rect(50, noteY, 4, 28).fill("#fbbf24");
      doc.fillColor(gray).fontSize(8).font("Helvetica-Bold").text("NOTE:", 62, noteY + 6);
      dataFont(8).fillColor(dark).text(order.note, 100, noteY + 6, { width: 430 });
    }

    // ── Footer ───────────────────────────────────────────────────
    const footerY = 760;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor("#e5e7eb").lineWidth(1).stroke();
    doc.fillColor(gray).fontSize(8).font("Helvetica")
      .text("Payment Method: Cash on Delivery — Pay when you receive", 50, footerY + 8)
      .text("Thank you for your order! | maggotfreekit.com", 50, footerY + 20, { align: "right" });

    doc.end();
  });
}
