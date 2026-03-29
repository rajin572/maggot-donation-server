import { Request, Response } from "express";
import * as OrdersService from "./orders.service";
import { generateInvoicePdf } from "../../utils/generateInvoicePdf";
import { ObjectId } from "mongodb";
import { getOrdersCollection } from "./orders.model";
import jwt from "jsonwebtoken";

export async function createOrder(req: Request, res: Response) {
  try {
    const result = await OrdersService.createOrder(req.body);
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[createOrder]", error);
    res.status(500).json({ success: false, message: "Failed to create order" });
  }
}

export async function updateOrderStatus(req: Request, res: Response) {
  try {
    const result = await OrdersService.updateOrderStatus(req.params.id, req.body.status, req.body.reason);
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[updateOrderStatus]", error);
    res.status(500).json({ success: false, message: "Failed to update order" });
  }
}

export async function getOrders(req: Request, res: Response) {
  try {
    const result = await OrdersService.getOrders(req.query as any);
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[getOrders]", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
}

export async function getOrderById(req: Request, res: Response) {
  try {
    const result = await OrdersService.getOrderById(req.params.id);
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[getOrderById]", error);
    res.status(500).json({ success: false, message: "Failed to fetch order" });
  }
}

export async function deleteOrder(req: Request, res: Response) {
  try {
    const result = await OrdersService.deleteOrder(req.params.id);
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[deleteOrder]", error);
    res.status(500).json({ success: false, message: "Failed to delete order" });
  }
}

export async function getOrderStats(_req: Request, res: Response) {
  try {
    const result = await OrdersService.getOrderStats();
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[getOrderStats]", error);
    res.status(500).json({ success: false, message: "Failed to fetch statistics" });
  }
}

export async function trackOrder(req: Request, res: Response) {
  try {
    const { id, t } = req.query as { id: string; t: string };
    const result = await OrdersService.trackOrder(id, t);
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[trackOrder]", error);
    res.status(500).json({ success: false, message: "Failed to track order" });
  }
}

export async function adminTrackOrder(req: Request, res: Response) {
  try {
    const { id } = req.query as { id: string };
    const result = await OrdersService.adminTrackOrder(id);
    res.status(result.status).json(result);
  } catch (error: any) {
    console.error("[adminTrackOrder]", error);
    res.status(500).json({ success: false, message: "Failed to track order" });
  }
}

// GET /orders/:id/invoice?type=admin|user  (requireAdmin)
export async function downloadAdminInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const type = req.query.type === "user" ? "user" : "admin";

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid order ID" });
      return;
    }

    const order = await getOrdersCollection().findOne({ _id: new ObjectId(id) });
    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    const pdfBuffer = await generateInvoicePdf(order, type);
    const filename = `invoice-${order.orderId}-${type}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error: any) {
    console.error("[downloadAdminInvoice]", error);
    res.status(500).json({ success: false, message: "Failed to generate invoice" });
  }
}

// GET /orders/invoice/user?id=orderId&t=trackingToken  (public)
export async function downloadUserInvoice(req: Request, res: Response) {
  try {
    const { id, t } = req.query as { id: string; t: string };

    if (!id || !t) {
      res.status(400).json({ success: false, message: "Order ID and tracking token are required" });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(t, process.env.JWT_SECRET as string);
    } catch {
      res.status(401).json({ success: false, message: "Invalid or expired tracking token" });
      return;
    }

    if (decoded.purpose !== "order_tracking" || decoded.orderId !== id) {
      res.status(401).json({ success: false, message: "Token does not match this order" });
      return;
    }

    const order = await getOrdersCollection().findOne({ orderId: id });
    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    const pdfBuffer = await generateInvoicePdf(order, "user");
    const filename = `invoice-${order.orderId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error: any) {
    console.error("[downloadUserInvoice]", error);
    res.status(500).json({ success: false, message: "Failed to generate invoice" });
  }
}
