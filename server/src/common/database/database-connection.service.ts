import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  createThrottledLogger,
  reconnectDelayMs,
} from '@/common/runtime/dependency';

@Injectable()
export class DatabaseConnectionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = createThrottledLogger('MySQL');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private attempt = 0;
  private poolAttached = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensureMetadata();
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  async isReachable(): Promise<boolean> {
    if (!this.dataSource.isInitialized) {
      return false;
    }
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      this.log(error);
      return false;
    }
  }

  async checkOnce(): Promise<void> {
    try {
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
        this.attempt = 0;
        this.attachPoolErrorHandler();
        return;
      }
      await this.dataSource.query('SELECT 1');
      this.attempt = 0;
      this.attachPoolErrorHandler();
    } catch (error) {
      this.attempt += 1;
      this.log(error);
      if (this.dataSource.isInitialized) {
        try {
          await this.dataSource.destroy();
        } catch (destroyError) {
          this.log(destroyError);
        }
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    await this.checkOnce();
    const delay = this.dataSource.isInitialized
      ? 15000
      : reconnectDelayMs(this.attempt);
    this.schedule(delay);
  }

  private schedule(delay: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
  }

  private async ensureMetadata(): Promise<void> {
    const source = this.dataSource as DataSource & {
      entityMetadatas?: unknown[];
      buildMetadatas?: () => Promise<void>;
    };
    if ((source.entityMetadatas?.length ?? 0) > 0 || !source.buildMetadatas) {
      return;
    }
    try {
      await source.buildMetadatas();
    } catch (error) {
      this.log(error);
    }
  }

  private attachPoolErrorHandler(): void {
    if (this.poolAttached) {
      return;
    }
    const pool = (
      this.dataSource.driver as {
        pool?: { on?: (event: string, listener: (error: unknown) => void) => void };
      }
    ).pool;
    if (!pool?.on) {
      return;
    }
    this.poolAttached = true;
    pool.on('error', (error) => this.log(error));
  }
}
