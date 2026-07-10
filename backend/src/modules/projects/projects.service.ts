import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { customAlphabet } from 'nanoid';
import { AppConfig } from '../../config/configuration';
import {
  PIPELINE_STEPS,
  PipelineStepId,
  PipelineStepState,
  Project,
  ProjectStatus,
  VideoInfo,
} from '../../common/interfaces';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

/**
 * Source of truth for projects. State lives in memory for fast reads and is
 * mirrored to `<outputPath>/<id>/project.json` so it survives restarts.
 *
 * No database (Phase 1). The interface is intentionally small so a real
 * repository can be dropped in later behind the same method surface.
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
        // Any project left mid-flight after a crash is marked failed.
        if (project.status === 'processing' || project.status === 'queued') {
          project.status = 'failed';
          project.error = 'Interrupted by server restart';
        }
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

  create(params: { originalName: string; originalPath: string; videoInfo?: VideoInfo }): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id: nanoid(),
      status: 'uploaded',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      originalName: params.originalName,
      originalPath: params.originalPath,
      videoInfo: params.videoInfo,
      steps: PIPELINE_STEPS.map(
        (s): PipelineStepState => ({ id: s.id, label: s.label, status: 'pending' }),
      ),
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

  /** Update a single step's state and recompute overall progress. */
  updateStep(id: string, stepId: PipelineStepId, patch: Partial<PipelineStepState>): Project {
    const project = this.findOne(id);
    const step = project.steps.find((s) => s.id === stepId);
    if (step) {
      Object.assign(step, patch);
      if (patch.status === 'running' && !step.startedAt) {
        step.startedAt = new Date().toISOString();
      }
      if (
        (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'skipped') &&
        step.startedAt
      ) {
        step.endedAt = new Date().toISOString();
        step.durationMs = Date.parse(step.endedAt) - Date.parse(step.startedAt);
      }
    }
    project.progress = this.computeProgress(project.steps);
    project.updatedAt = new Date().toISOString();
    this.persist(project);
    return project;
  }

  private computeProgress(steps: PipelineStepState[]): number {
    const done = steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
    return Math.round((done / steps.length) * 100);
  }

  /** Remove a project record and all of its on-disk artifacts. */
  remove(id: string): void {
    const project = this.findOne(id);
    // Remove output artifacts.
    fs.rmSync(this.projectDir(id), { recursive: true, force: true });
    // Remove preserved original + upload workspace.
    if (project.originalPath && fs.existsSync(project.originalPath)) {
      const uploadDir = path.dirname(path.dirname(project.originalPath));
      // uploadDir is `<uploads>/<id>` — guard against deleting anything else.
      if (path.basename(uploadDir) === id) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      }
    }
    this.projects.delete(id);
  }
}
