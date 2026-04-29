import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectKnowledgeDoctorWarnings } from "./doctor-knowledge.js";

const originalStateDir = process.env.EDWINPAI_STATE_DIR;

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.EDWINPAI_STATE_DIR;
  } else {
    process.env.EDWINPAI_STATE_DIR = originalStateDir;
  }
});

describe("collectKnowledgeDoctorWarnings", () => {
  it("warns when knowledge disciplines json is malformed", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edwinpai-doctor-knowledge-"));
    fs.mkdirSync(path.join(stateDir, "knowledge"), { recursive: true });
    fs.writeFileSync(path.join(stateDir, "knowledge", "disciplines.json"), "{not json}\n");
    process.env.EDWINPAI_STATE_DIR = stateDir;

    const warnings = collectKnowledgeDoctorWarnings({});
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("knowledge/disciplines.json could not be read"),
      ]),
    );
  });

  it("warns when a default profile binding points at a missing discipline-backed profile", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edwinpai-doctor-knowledge-"));
    fs.mkdirSync(path.join(stateDir, "knowledge"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "knowledge", "disciplines.json"),
      JSON.stringify({ disciplines: [{ id: "research", selectedCollections: ["workspace"] }] }),
    );
    process.env.EDWINPAI_STATE_DIR = stateDir;

    const warnings = collectKnowledgeDoctorWarnings({
      agents: {
        defaults: {
          subagents: {
            profileBindings: {
              helper: "missing-profile",
            },
          },
        },
      },
    });
    expect(warnings).toContain(
      '- agents.defaults.subagents profileBindings.helper -> "missing-profile" does not exist in subagent profiles or knowledge disciplines',
    );
  });

  it("warns when an agent profile binding resolves to a profile without selectedCollections", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edwinpai-doctor-knowledge-"));
    fs.mkdirSync(path.join(stateDir, "knowledge"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "knowledge", "disciplines.json"),
      JSON.stringify({ disciplines: [] }),
    );
    process.env.EDWINPAI_STATE_DIR = stateDir;

    const warnings = collectKnowledgeDoctorWarnings({
      agents: {
        list: [
          {
            id: "main",
            subagents: {
              profiles: {
                research: {
                  runtimeAttachmentPolicy: "mounted-only",
                },
              },
              profileBindings: {
                helper: "research",
              },
            },
          },
        ],
      },
    });
    expect(warnings).toContain(
      '- agents.list[main].subagents profileBindings.helper -> "research" resolves to a profile without selectedCollections',
    );
  });
});
