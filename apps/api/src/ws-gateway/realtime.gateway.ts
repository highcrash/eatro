import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';

import type { WsEvent } from '@restora/types';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IoServer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IoSocket = any;

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: IoServer;

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: IoSocket): void {
    console.warn(`WS client connected: ${String(client.id)}`);
  }

  handleDisconnect(client: IoSocket): void {
    console.warn(`WS client disconnected: ${String(client.id)}`);
  }

  @SubscribeMessage('join:branch')
  handleJoinBranch(
    @MessageBody() branchId: string,
    @ConnectedSocket() client: IoSocket,
  ): void {
    void client.join(`branch:${branchId}`);
  }

  @SubscribeMessage('join:kds')
  handleJoinKds(
    @MessageBody() branchId: string,
    @ConnectedSocket() client: IoSocket,
  ): void {
    void client.join(`kds:${branchId}`);
  }

  @SubscribeMessage('kds:ticket:preparing')
  async handleTicketPreparing(
    @MessageBody() orderId: string,
    @ConnectedSocket() client: IoSocket,
  ): Promise<void> {
    // Update all NEW items on this order to PREPARING
    const order = await this.prisma.order.findFirst({ where: { id: orderId } });
    if (!order) return;

    await this.prisma.orderItem.updateMany({
      where: { orderId, kitchenStatus: 'NEW', voidedAt: null },
      data: { kitchenStatus: 'PREPARING' },
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'PREPARING',
        // Capture the very first transition timestamp — drives the
        // POS Tables "kitchen acked" timer. Skip if already set so
        // re-clicking Start doesn't reset the clock.
        ...(order.firstKitchenStartAt ? {} : { firstKitchenStartAt: new Date() }),
      },
    });

    // Broadcast to all KDS and branch clients
    client.to(`kds:${order.branchId}`).emit('kds:ticket:preparing', orderId);
    this.emitToBranch(order.branchId, 'order:updated', await this.prisma.order.findFirst({
      where: { id: orderId },
      include: { items: true, payments: true },
    }));
  }

  @SubscribeMessage('kds:ticket:done')
  async handleTicketDone(
    @MessageBody() orderId: string,
    @ConnectedSocket() client: IoSocket,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId } });
    if (!order) return;

    // Update all PREPARING items to DONE
    await this.prisma.orderItem.updateMany({
      where: { orderId, kitchenStatus: 'PREPARING', voidedAt: null },
      data: { kitchenStatus: 'DONE' },
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'READY',
        // Capture the first time kitchen marked everything DONE so
        // the POS Tables "served-pending" timer can start. Skip when
        // already set (idempotent).
        ...(order.firstKitchenDoneAt ? {} : { firstKitchenDoneAt: new Date() }),
      },
    });

    // Broadcast
    client.to(`kds:${order.branchId}`).emit('kds:ticket:done', orderId);
    this.emitToBranch(order.branchId, 'order:updated', await this.prisma.order.findFirst({
      where: { id: orderId },
      include: { items: true, payments: true },
    }));
  }

  emitToBranch(branchId: string, event: WsEvent, data: unknown): void {
    this.server.to(`branch:${branchId}`).emit(event, data);
  }

  emitToKds(branchId: string, event: WsEvent, data: unknown): void {
    this.server.to(`kds:${branchId}`).emit(event, data);
  }
}
