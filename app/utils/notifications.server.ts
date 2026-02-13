import prisma from "../db.server";
import type { NotificationType } from "@prisma/client";

interface CreateNotificationInput {
  shop: string;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl?: string;
  referenceId?: string;
}

export async function createNotification({
  shop,
  type,
  title,
  message,
  linkUrl,
  referenceId,
}: CreateNotificationInput) {
  // De-duplicate by referenceId when provided
  if (referenceId) {
    const existing = await prisma.notification.findUnique({
      where: { shop_type_referenceId: { shop, type, referenceId } },
    });
    if (existing) return existing;
  }

  return prisma.notification.create({
    data: { shop, type, title, message, linkUrl, referenceId },
  });
}

export async function getUnreadCount(shop: string) {
  return prisma.notification.count({
    where: { shop, isRead: false },
  });
}

export async function getNotifications(
  shop: string,
  { take = 10, skip = 0 }: { take?: number; skip?: number } = {},
) {
  return prisma.notification.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });
}

export async function markAsRead(id: string, shop: string) {
  return prisma.notification.updateMany({
    where: { id, shop },
    data: { isRead: true },
  });
}

export async function markAllAsRead(shop: string) {
  return prisma.notification.updateMany({
    where: { shop, isRead: false },
    data: { isRead: true },
  });
}
