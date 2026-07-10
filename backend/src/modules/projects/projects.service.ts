import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { customAlphabet } from 'nanoid';
import { AppConfig } from '../../config/configuration';
import { Project, ProjectStatus } from '../../common/interfaces';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

/**
 * Source of truth for projects. State lives in memory for fast reads and is
 * mirrored to `<outputPath>/<id>/project.json` so it survives restarts.
 *
 * No database (Phase 1). The method surface is intentionally small so a real
 * repository can be dropped in later without changing call sites.
 */
@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly projects = new Map<string, Project>();
  private readonly outputPath: string;

  constructor(config: ConfigService) {
    this.outputPath = config.getOrThrow<AppConfig>('app').outputPath;
  }

  /** Rehydrate any previously persisted projects on boot. */
  onModuleInit(): void {
    fs.mkdirSync(this.outputPath, { recursive: true });
    for (const entry of fs.readdirSync(this.outputPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.outputPath, entry.name, 'project.json');
      if (!fs.existsSync(file)) continue;
      try {
        const project = JSON.parse(fs.readFileSync(file, 'utf8')) as Project;
        project.faces ??= [];
        this.projects.set(project.id, project);
      } catch (err) {
        this.logger.warn(`Could not load project at ${file}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Loaded ${this.projects.size} existing project(s)`);
  }

  private projectDir(id: string): string {
    return path.join(this.outputPath, id);
  }

  private persist(project: Project): void {
    const dir = this.projectDir(project.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
  }

  create(params: { originalName: string }): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id: nanoid(),
      status: 'completed', // set to failed only if storage errors out
      createdAt: now,
      updatedAt: now,
      originalName: params.originalName,
      faces: [],
    };
    this.projects.set(project.id, project);
    this.persist(project);
    return project;
  }

  findAll(): Project[] {
    return [...this.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  findOne(id: string): Project {
    const project = this.projects.get(id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  /** Apply a partial update, bump `updatedAt`, and persist. */
  update(id: string, patch: Partial<Project>): Project {
    const project = this.findOne(id);
    Object.assign(project, patch, { updatedAt: new Date().toISOString() });
    this.persist(project);
    return project;
  }

  setStatus(id: string, status: ProjectStatus, error?: string): Project {
    return this.update(id, { status, ...(error ? { error } : {}) });
  }

  /** Remove a project record and all of its on-disk artifacts. */
  remove(id: string): void {
    this.findOne(id); // 404 if unknown
    fs.rmSync(this.projectDir(id), { recursive: true, force: true });
    this.projects.delete(id);
  }
}
