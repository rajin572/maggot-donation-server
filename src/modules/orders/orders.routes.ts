import { Router } from "express";
import * as OrdersController from "./orders.controller";
import { requireAdmin } from "../../middleware/authMiddleware";

const router = Router();

// Public — customer facing
router.post("/", OrdersController.createOrder);
router.get("/track", OrdersController.trackOrder);
router.get("/invoice/user", OrdersController.downloadUserInvoice);

// Admin only
router.get("/stats/summary", requireAdmin, OrdersController.getOrderStats);
router.get("/admin-track", requireAdmin, OrdersController.adminTrackOrder);
router.get("/", requireAdmin, OrdersController.getOrders);
router.get("/:id/invoice", requireAdmin, OrdersController.downloadAdminInvoice);
router.get("/:id", requireAdmin, OrdersController.getOrderById);
router.patch("/:id", requireAdmin, OrdersController.updateOrderStatus);
router.delete("/:id", requireAdmin, OrdersController.deleteOrder);

export default router;
