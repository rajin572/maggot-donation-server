import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { getOrdersCollection } from "./orders.model";
import { ICreateOrderPayload, IOrdersQuery } from "./orders.interface";
import { sendEmail } from "../../utils/mailer";
import { getDB } from "../../config/db";
import { getProductCollection } from "../product/product.model";
import { validateCoupon, applyCouponUsage } from "../coupons/coupons.service";
import { generateInvoicePdf } from "../../utils/generateInvoicePdf";

const VALID_STATUSES = ["pending", "approved", "declined", "cancelled", "completed"];

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getProductConfig() {
  const product = await getProductCollection().findOne({});
  return {
    pricePerKit: (product?.pricePerKit as number) ?? 230,
    deliveryFeeInsideDhaka: (product?.deliveryFeeInsideDhaka as number) ?? 60,
    deliveryFeeOutsideDhaka: (product?.deliveryFeeOutsideDhaka as number) ?? 120,
    deliveryFeeThreshold: (product?.deliveryFeeThreshold as number) ?? 5,
  };
}

async function generateOrderId(): Promise<string> {
  const today = new Date();
  const dateKey = today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");

  const counters = getDB().collection("counters");
  const result = await counters.findOneAndUpdate(
    { _id: `order_seq_${dateKey}` as any },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  const seq = result!.seq as number;
  return `MF-${dateKey}-${String(seq).padStart(4, "0")}`;
}

export async function createOrder(payload: ICreateOrderPayload) {
  const { name, email, phone, district, insideDhaka, address, quantity, note, couponCode } = payload;

  if (!name || !phone || !district || insideDhaka === undefined || !address || !quantity) {
    return {
      status: 400,
      success: false,
      message: "Name, phone, district, insideDhaka, address, and quantity are required",
    };
  }

  if (quantity <= 0) {
    return { status: 400, success: false, message: "Quantity must be greater than 0" };
  }

  const orderId = await generateOrderId();
  const config = await getProductConfig();
  const qty = Number(quantity);
  const isInside = Boolean(insideDhaka);
  const baseFee = isInside ? config.deliveryFeeInsideDhaka : config.deliveryFeeOutsideDhaka;
  const deliveryFee = Math.ceil(qty / config.deliveryFeeThreshold) * baseFee;
  const subtotal = config.pricePerKit * qty + deliveryFee;

  // Validate and apply coupon
  let discountAmount = 0;
  let appliedCouponCode: string | null = null;
  if (couponCode) {
    const couponResult = await validateCoupon(couponCode, subtotal);
    if (couponResult.success && couponResult.data) {
      discountAmount = (couponResult.data as any).discountAmount;
      appliedCouponCode = (couponResult.data as any).code;
    }
  }

  const newOrder = {
    orderId,
    name,
    email: email || null,
    phone,
    district,
    insideDhaka: isInside,
    address,
    quantity: qty,
    pricePerKit: config.pricePerKit,
    deliveryFee,
    discountAmount,
    totalPrice: subtotal - discountAmount,
    couponCode: appliedCouponCode,
    note: note || null,
    status: "pending" as const,
    statusHistory: [{ status: "pending", changedAt: new Date() }],
    orderDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await getOrdersCollection().insertOne(newOrder);

  // Mark coupon as used
  if (appliedCouponCode) {
    applyCouponUsage(appliedCouponCode).catch(console.error);
  }

  const trackingToken = jwt.sign(
    { orderId, purpose: "order_tracking" },
    process.env.JWT_SECRET as string,
    { expiresIn: "30d" }
  );

  if (email) {
    sendOrderTrackingEmail(email, name, orderId, newOrder).catch(console.error);
  }

  // Notify admin about new order
  const adminEmail = process.env.EMAIL_USER;
  if (adminEmail) {
    sendAdminNewOrderEmail(adminEmail, newOrder).catch(console.error);
  }

  return {
    status: 201,
    success: true,
    message: "Order created successfully",
    data: { trackingToken, ...newOrder },
  };
}

async function sendAdminNewOrderEmail(adminEmail: string, order: any) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 20px 24px; border-radius: 10px 10px 0 0;">
        <h2 style="color: #fbbf24; margin: 0; font-size: 18px;">🛒 নতুন অর্ডার পাওয়া গেছে!</h2>
      </div>
      <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #6b7280;">অর্ডার আইডি</td><td style="padding: 6px 0; font-weight: bold; color: #111827;">${escapeHtml(order.orderId)}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">নাম</td><td style="padding: 6px 0; color: #111827;">${escapeHtml(order.name)}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">ফোন</td><td style="padding: 6px 0; color: #111827;">${escapeHtml(order.phone)}</td></tr>
          ${order.email ? `<tr><td style="padding: 6px 0; color: #6b7280;">ইমেইল</td><td style="padding: 6px 0; color: #111827;">${escapeHtml(order.email)}</td></tr>` : ""}
          <tr><td style="padding: 6px 0; color: #6b7280;">জেলা</td><td style="padding: 6px 0; color: #111827;">${escapeHtml(order.district)}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">এলাকা</td><td style="padding: 6px 0; color: #111827;">${order.insideDhaka ? "ঢাকার ভেতরে" : "ঢাকার বাইরে"}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">ঠিকানা</td><td style="padding: 6px 0; color: #111827;">${escapeHtml(order.address)}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">পরিমাণ</td><td style="padding: 6px 0; color: #111827;">${escapeHtml(String(order.quantity))} কিট</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">প্রতি কিট</td><td style="padding: 6px 0; color: #111827;">৳${order.pricePerKit?.toLocaleString()}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">ডেলিভারি চার্জ</td><td style="padding: 6px 0; color: #111827;">৳${order.deliveryFee?.toLocaleString()}</td></tr>
          ${order.couponCode ? `<tr><td style="padding: 6px 0; color: #6b7280;">কুপন (${escapeHtml(order.couponCode)})</td><td style="padding: 6px 0; color: #16a34a;">-৳${order.discountAmount?.toLocaleString()}</td></tr>` : ""}
          <tr style="border-top: 2px solid #1a1a2e;">
            <td style="padding: 10px 0 4px; font-weight: bold; color: #1a1a2e;">মোট পরিশোধযোগ্য</td>
            <td style="padding: 10px 0 4px; font-weight: bold; font-size: 16px; color: #1a1a2e;">৳${order.totalPrice?.toLocaleString()}</td>
          </tr>
        </table>
        ${order.note ? `<p style="margin-top: 12px; padding: 10px; background: #fff; border-left: 3px solid #fbbf24; font-size: 13px; color: #374151;"><strong>নোট:</strong> ${escapeHtml(order.note)}</p>` : ""}
      </div>
    </div>
  `;
  await sendEmail(adminEmail, `নতুন অর্ডার: ${order.orderId} — ম্যাগট-ফ্রি রেসকিউ কিট`, html);
}

async function sendOrderTrackingEmail(email: string, name: string, orderId: string, order: any) {
  const token = jwt.sign(
    { orderId, purpose: "order_tracking" },
    process.env.JWT_SECRET as string,
    { expiresIn: "30d" }
  );

  const trackingUrl = `${process.env.WEBSITE_URL}/track?id=${orderId}&t=${token}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 20px 24px; border-radius: 10px 10px 0 0;">
        <h2 style="color: #fbbf24; margin: 0; font-size: 18px;">✅ অর্ডার নিশ্চিত হয়েছে!</h2>
      </div>
      <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
        <p style="color: #374151; margin-bottom: 12px;">প্রিয় ${escapeHtml(name)},</p>
        <p style="color: #374151; margin-bottom: 16px;">আপনার অর্ডার সফলভাবে গৃহীত হয়েছে। Invoice এই ইমেইলের সাথে সংযুক্ত রয়েছে।</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
          <tr><td style="padding: 6px 0; color: #6b7280;">অর্ডার আইডি</td><td style="padding: 6px 0; font-weight: bold; color: #111827;">${orderId}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">পরিমাণ</td><td style="padding: 6px 0; color: #111827;">${order.quantity} কিট</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">ডেলিভারি চার্জ</td><td style="padding: 6px 0; color: #111827;">৳${order.deliveryFee?.toLocaleString()}</td></tr>
          ${order.couponCode ? `<tr><td style="padding: 6px 0; color: #6b7280;">কুপন (${escapeHtml(order.couponCode)})</td><td style="padding: 6px 0; color: #16a34a;">-৳${order.discountAmount?.toLocaleString()}</td></tr>` : ""}
          <tr style="border-top: 2px solid #1a1a2e;"><td style="padding: 10px 0 4px; font-weight: bold; color: #1a1a2e;">মোট পরিশোধযোগ্য</td><td style="padding: 10px 0 4px; font-weight: bold; font-size: 16px; color: #1a1a2e;">৳${order.totalPrice?.toLocaleString()}</td></tr>
        </table>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${trackingUrl}" style="background-color: #1a1a2e; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; display: inline-block;">
            অর্ডার ট্র্যাক করুন
          </a>
        </div>
        <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">ট্র্যাকিং লিংক ৩০ দিনের জন্য বৈধ।</p>
      </div>
    </div>
  `;

  // Generate and attach user invoice PDF
  let attachments;
  try {
    const pdfBuffer = await generateInvoicePdf(order, "user");
    attachments = [{ filename: `invoice-${orderId}.pdf`, content: pdfBuffer, contentType: "application/pdf" }];
  } catch (err) {
    console.error("[Invoice PDF generation failed]", err);
  }

  await sendEmail(email, `অর্ডার নিশ্চিত: ${orderId} — ম্যাগট-ফ্রি রেসকিউ কিট`, html, attachments);
}

export async function updateOrderStatus(id: string, status: string, reason?: string) {
  if (!ObjectId.isValid(id)) {
    return { status: 400, success: false, message: "Invalid order ID" };
  }

  if (!status || !VALID_STATUSES.includes(status.toLowerCase())) {
    return {
      status: 400,
      success: false,
      message: `Status must be one of: ${VALID_STATUSES.join(", ")}`,
    };
  }

  const historyEntry: { status: string; changedAt: Date; reason?: string } = {
    status: status.toLowerCase(),
    changedAt: new Date(),
  };
  if (reason) historyEntry.reason = reason;

  const result = await getOrdersCollection().findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: { status: status.toLowerCase(), updatedAt: new Date() },
      $push: { statusHistory: historyEntry as any },
    },
    { returnDocument: "after" }
  );

  if (!result) {
    return { status: 404, success: false, message: "Order not found" };
  }

  // Send status update email to customer if they have an email
  if (result.email) {
    sendStatusUpdateEmail(result.email as string, result.name as string, result.orderId as string, status.toLowerCase(), reason).catch(console.error);
  }

  return { status: 200, success: true, message: "Order status updated successfully", data: result };
}

const STATUS_LABELS_BN: Record<string, string> = {
  pending: "অপেক্ষমান",
  approved: "অনুমোদিত",
  completed: "সম্পন্ন",
  declined: "বাতিল",
  cancelled: "বাতিল করা হয়েছে",
};

async function sendStatusUpdateEmail(email: string, name: string, orderId: string, status: string, reason?: string) {
  const statusLabel = STATUS_LABELS_BN[status] ?? status;
  const isCancelled = status === "cancelled" || status === "declined";

  const statusColor = {
    pending: "#d97706",
    approved: "#2563eb",
    completed: "#16a34a",
    declined: "#dc2626",
    cancelled: "#6b7280",
  }[status] ?? "#6b7280";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 20px 24px; border-radius: 10px 10px 0 0;">
        <h2 style="color: #fbbf24; margin: 0; font-size: 18px;">অর্ডার স্ট্যাটাস আপডেট</h2>
      </div>
      <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb;">
        <p style="margin: 0 0 16px; color: #374151;">প্রিয় ${escapeHtml(name)},</p>
        <p style="margin: 0 0 16px; color: #374151;">আপনার অর্ডার <strong>${escapeHtml(orderId)}</strong>-এর স্ট্যাটাস আপডেট হয়েছে।</p>
        <div style="text-align: center; margin: 20px 0;">
          <span style="display: inline-block; padding: 8px 20px; border-radius: 999px; background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}; font-weight: 600; font-size: 15px;">
            ${statusLabel}
          </span>
        </div>
        ${isCancelled && reason ? `
        <div style="margin-top: 16px; padding: 14px; background: #fff3cd; border-left: 3px solid #fbbf24; border-radius: 4px;">
          <p style="margin: 0; font-size: 13px; color: #92400e;"><strong>কারণ:</strong> ${escapeHtml(reason!)}</p>
        </div>` : ""}
        <p style="margin-top: 20px; color: #6b7280; font-size: 13px;">কোনো সমস্যা হলে আমাদের সাথে যোগাযোগ করুন।</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">ম্যাগট-ফ্রি রেসকিউ কিট</p>
      </div>
    </div>
  `;

  await sendEmail(email, `অর্ডার আপডেট: ${orderId} — ${statusLabel}`, html);
}

export async function getOrders(query: IOrdersQuery) {
  const {
    page = "1",
    limit = "10",
    status,
    insideDhaka,
    orderDate,
    search,
    sortBy = "orderDate",
    sortOrder = "desc",
  } = query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit) || 10), 10000);
  const skip = (pageNum - 1) * limitNum;

  const filter: Record<string, any> = {};

  if (status) filter.status = status.toLowerCase();
  if (insideDhaka !== undefined) filter.insideDhaka = insideDhaka === "true";

  if (orderDate) {
    const startDate = new Date(orderDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(orderDate);
    endDate.setHours(23, 59, 59, 999);
    filter.orderDate = { $gte: startDate, $lte: endDate };
  }

  if (search) {
    // Escape special regex characters to prevent ReDoS
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { orderId: { $regex: safeSearch, $options: "i" } },
      { name: { $regex: safeSearch, $options: "i" } },
      { phone: { $regex: safeSearch, $options: "i" } },
      { email: { $regex: safeSearch, $options: "i" } },
    ];
  }

  // Whitelist sortBy to prevent query manipulation
  const ALLOWED_SORT_FIELDS = ["orderDate", "quantity", "totalPrice", "createdAt"];
  const safeSortBy = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : "orderDate";
  const sort: Record<string, 1 | -1> = { [safeSortBy]: sortOrder === "asc" ? 1 : -1 };
  const collection = getOrdersCollection();

  const totalOrders = await collection.countDocuments(filter);
  const totalPages = Math.ceil(totalOrders / limitNum);
  const orders = await collection.find(filter).sort(sort).skip(skip).limit(limitNum).toArray();

  return {
    status: 200,
    success: true,
    data: orders,
    pagination: {
      currentPage: pageNum,
      totalPages,
      totalOrders,
      limit: limitNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
  };
}

export async function getOrderById(id: string) {
  if (!ObjectId.isValid(id)) {
    return { status: 400, success: false, message: "Invalid order ID" };
  }

  const order = await getOrdersCollection().findOne({ _id: new ObjectId(id) });
  if (!order) {
    return { status: 404, success: false, message: "Order not found" };
  }

  return { status: 200, success: true, data: order };
}

export async function deleteOrder(id: string) {
  if (!ObjectId.isValid(id)) {
    return { status: 400, success: false, message: "Invalid order ID" };
  }

  const result = await getOrdersCollection().deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) {
    return { status: 404, success: false, message: "Order not found" };
  }

  return { status: 200, success: true, message: "Order deleted successfully" };
}

export async function getOrderStats() {
  const collection = getOrdersCollection();

  const [
    totalOrders,
    pendingOrders,
    approvedOrders,
    declinedOrders,
    cancelledOrders,
    completedOrders,
    insideDhakaOrders,
    outsideDhakaOrders,
    quantityResult,
  ] = await Promise.all([
    collection.countDocuments(),
    collection.countDocuments({ status: "pending" }),
    collection.countDocuments({ status: "approved" }),
    collection.countDocuments({ status: "declined" }),
    collection.countDocuments({ status: "cancelled" }),
    collection.countDocuments({ status: "completed" }),
    collection.countDocuments({ insideDhaka: true }),
    collection.countDocuments({ insideDhaka: false }),
    collection.aggregate([{ $group: { _id: null, totalQuantity: { $sum: "$quantity" } } }]).toArray(),
  ]);

  return {
    status: 200,
    success: true,
    data: {
      totalOrders,
      pendingOrders,
      approvedOrders,
      declinedOrders,
      cancelledOrders,
      completedOrders,
      insideDhakaOrders,
      outsideDhakaOrders,
      totalQuantity: quantityResult[0]?.totalQuantity || 0,
    },
  };
}

export async function adminTrackOrder(id: string) {
  if (!id) {
    return { status: 400, success: false, message: "Order ID is required" };
  }

  const order = await getOrdersCollection().findOne({ orderId: id });
  if (!order) {
    return { status: 404, success: false, message: "Order not found" };
  }

  return { status: 200, success: true, data: order };
}

export async function trackOrder(id: string, token: string) {
  if (!id || !token) {
    return { status: 400, success: false, message: "Order ID and tracking token are required" };
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string);
  } catch {
    return { status: 401, success: false, message: "Invalid or expired tracking token" };
  }

  if (decoded.purpose !== "order_tracking" || decoded.orderId !== id) {
    return { status: 401, success: false, message: "Tracking token does not match this order" };
  }

  const order = await getOrdersCollection().findOne({ orderId: id });
  if (!order) {
    return { status: 404, success: false, message: "Order not found" };
  }

  return { status: 200, success: true, data: order };
}
