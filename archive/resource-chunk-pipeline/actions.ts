// ARCHIVED 2026-09-03 — R102. Eight action handlers lifted verbatim out of
// supabase/functions/resource-processing/index.ts (commit a9ded0b), in reverse source
// order. See ./NOTES.md for what each did, what still exists to support them, and the
// exact steps to bring any of them back.

async function extractPdfChunks(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  if (resource.resource_type !== "pdf" || resource.source_type !== "upload") {
    throw new Error("Only uploaded PDF resources can be extracted in v1.");
  }

  const rawChunks = Array.isArray(body.chunks) ? (body.chunks as ChunkInput[]) : [];
  if (!rawChunks.length) throw new Error("No PDF text chunks were provided.");
  if (rawChunks.length > MAX_CHUNKS) throw new Error("Too many chunks. Keep extraction under 500 chunks.");

  const chunks = rawChunks.map((chunk, index) =>
    normalizeChunk({ ...chunk, source_kind: "document" }, index),
  );
  const userId = String(user.id);

  const jobRows = await supabaseFetch(config, "resource_processing_jobs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      resource_id: resourceId,
      organization_id: resource.organization_id || null,
      class_id: resource.class_id || null,
      lesson_id: resource.lesson_id || null,
      job_type: "pdf_text_extraction",
      status: "complete",
      requested_by: userId,
      completed_by: userId,
      chunk_count: chunks.length,
      metadata:
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
      completed_at: new Date().toISOString(),
    }),
  });
  const job = Array.isArray(jobRows) ? (jobRows[0] as DbRow | undefined) : undefined;
  if (!job?.id) throw new Error("Could not create processing job.");

  await supabaseFetch(
    config,
    `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&status=eq.draft`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
  );

  const insertRows = chunks.map((chunk) => ({
    ...chunk,
    resource_id: resourceId,
    job_id: job.id,
    organization_id: resource.organization_id || null,
    class_id: resource.class_id || null,
    lesson_id: resource.lesson_id || null,
    status: "draft",
    created_by: userId,
    updated_by: userId,
  }));
  const inserted = await supabaseFetch(config, "resource_text_chunks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(insertRows),
  });

  return {
    status: "ok",
    resource_id: resourceId,
    job_id: job.id,
    chunks: inserted,
  };
}


async function transcribeWithOpenAi(
  openAiKey: string,
  resource: DbRow,
  mediaBlob: Blob,
): Promise<DbRow> {
  const fileName = resourceFileName(resource);
  const extension = fileExtension(fileName);
  const mimeType = mimeTypeForExtension(extension, cleanText(resource.mime_type));
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("file", new File([mediaBlob], fileName, { type: mimeType }));

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
    },
    body: form,
  });
  const data = (await res.json().catch(() => null)) as DbRow | null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? cleanText((data.error as DbRow)?.message, res.statusText)
        : res.statusText;
    throw new Error(`OpenAI transcription failed: ${message}`);
  }
  if (!data || typeof data !== "object") {
    throw new Error("OpenAI transcription returned an invalid response.");
  }
  return data;
}


async function transcribeMediaResource(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  assertSupportedMedia(resource);

  const sourceKind = resource.resource_type === "video" ? "video" : "audio";
  const jobType: ProcessingJobType =
    sourceKind === "video" ? "video_transcription" : "audio_transcription";
  const openAiKey = requireOpenAiKey();
  const job = await createProcessingJob(config, resource, user, jobType, "processing", {
    model: "whisper-1",
    supported_limit_bytes: MAX_TRANSCRIPTION_BYTES,
  });
  const processingStartedAt = Date.now();

  try {
    const mediaBlob = await downloadResourceFile(config, resource);
    const transcription = await transcribeWithOpenAi(openAiKey, resource, mediaBlob);
    const chunks = chunksFromTranscriptionResponse(transcription, sourceKind);
    if (!chunks.length) {
      throw new Error("No transcript text was found in this media file.");
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new Error("Too many transcript chunks. Use a shorter file for v1.");
    }

    await supabaseFetch(
      config,
      `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&status=eq.draft&source_kind=eq.${sourceKind}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      },
    );

    const insertRows = chunks.map((chunk) => ({
      ...chunk,
      resource_id: resourceId,
      job_id: job.id,
      organization_id: resource.organization_id || null,
      class_id: resource.class_id || null,
      lesson_id: resource.lesson_id || null,
      status: "draft",
      created_by: user.id,
      updated_by: user.id,
    }));
    const inserted = await supabaseFetch(config, "resource_text_chunks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(insertRows),
    });

    await updateProcessingJob(config, String(job.id), {
      status: "complete",
      completed_by: user.id,
      chunk_count: chunks.length,
      completed_at: new Date().toISOString(),
      metadata: {
        media_size_bytes: mediaBlob.size,
        response_format: "verbose_json",
        timestamp_granularity: "segment",
      },
    });
    await insertModelUsage(config, resource, user, {
      model: "whisper-1",
      taskType: "speech_to_text",
      status: "ok",
      latencyMs: Date.now() - processingStartedAt,
      payload: {
        job_id: job.id,
        resource_id: resourceId,
        source_kind: sourceKind,
        media_size_bytes: mediaBlob.size,
      },
    });

    return {
      status: "ok",
      resource_id: resourceId,
      job_id: job.id,
      chunks: inserted,
    };
  } catch (error) {
    const message = errorMessage(error);
    await updateProcessingJob(config, String(job.id), {
      status: "failed",
      completed_by: user.id,
      error_count: 1,
      completed_at: new Date().toISOString(),
    });
    await insertProcessingError(config, resourceId, String(job.id), message, {
      action: "transcribe_media_resource",
      resource_type: resource.resource_type,
    });
    await insertModelUsage(config, resource, user, {
      model: "whisper-1",
      taskType: "speech_to_text",
      status: "error",
      latencyMs: Date.now() - processingStartedAt,
      payload: {
        job_id: job.id,
        resource_id: resourceId,
        source_kind: sourceKind,
        error: message,
      },
    });
    throw error;
  }
}


async function saveChunkEdits(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  await requireManageableResource(config, resourceId);
  const chunks = Array.isArray(body.chunks) ? (body.chunks as ChunkInput[]) : [];
  if (!chunks.length) throw new Error("No chunk edits were provided.");
  if (chunks.length > 100) throw new Error("Too many chunk edits in one request.");

  const updated: DbRow[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunkId = cleanId(chunks[i].id);
    if (!chunkId) throw new Error("chunk id is required.");
    const normalized = normalizeChunk(chunks[i], i);
    const patch: DbRow = {
      page_number: normalized.page_number,
      chunk_index: normalized.chunk_index,
      chunk_text: normalized.chunk_text,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if ("metadata" in chunks[i]) patch.metadata = normalized.metadata;
    if ("source_kind" in chunks[i]) patch.source_kind = normalized.source_kind;
    if ("start_seconds" in chunks[i]) patch.start_seconds = normalized.start_seconds;
    if ("end_seconds" in chunks[i]) patch.end_seconds = normalized.end_seconds;
    if ("confidence" in chunks[i]) patch.confidence = normalized.confidence;
    const rows = await supabaseFetch(
      config,
      `resource_text_chunks?id=eq.${encodeURIComponent(chunkId)}&resource_id=eq.${encodeURIComponent(resourceId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
    );
    if (Array.isArray(rows) && rows[0]) updated.push(rows[0] as DbRow);
  }
  return { status: "ok", chunks: updated };
}


async function setChunkStatus(
  config: Config,
  body: DbRow,
  user: DbRow,
  status: "approved" | "rejected",
) {
  const resourceId = cleanId(body.resource_id);
  await requireManageableResource(config, resourceId);
  const chunkIds = Array.isArray(body.chunk_ids)
    ? (body.chunk_ids as unknown[]).map(cleanId).filter(Boolean)
    : [];
  if (!chunkIds.length) throw new Error("Select at least one chunk.");
  if (chunkIds.length > 200) throw new Error("Too many chunks in one status update.");

  const rows = await supabaseFetch(
    config,
    `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&id=${idFilter(chunkIds)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return { status: "ok", chunks: rows };
}


async function deleteChunks(config: Config, body: DbRow) {
  const resourceId = cleanId(body.resource_id);
  await requireManageableResource(config, resourceId);
  const chunkIds = Array.isArray(body.chunk_ids)
    ? (body.chunk_ids as unknown[]).map(cleanId).filter(Boolean)
    : [];
  if (!chunkIds.length) throw new Error("Select at least one chunk.");
  if (chunkIds.length > 200) throw new Error("Too many chunks in one delete request.");

  await supabaseFetch(
    config,
    `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&id=${idFilter(chunkIds)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
  );
  return { status: "ok", deleted_chunk_ids: chunkIds };
}


async function createCurriculumImportDraft(config: Config, body: DbRow, user: DbRow) {
  const resourceId = cleanId(body.resource_id);
  const resource = await requireManageableResource(config, resourceId);
  const title = cleanText(resource.title, "Teacher resource");
  const chunks = await supabaseFetch(
    config,
    `resource_text_chunks?resource_id=eq.${encodeURIComponent(resourceId)}&status=eq.approved&select=*&order=page_number.asc,start_seconds.asc,chunk_index.asc&limit=20`,
  ) as DbRow[];
  if (!Array.isArray(chunks) || !chunks.length) {
    throw new Error("Approve at least one resource chunk before creating curriculum suggestions.");
  }
  const sampleText = chunks
    .map((chunk) => cleanText(chunk.chunk_text))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);
  const objective = firstSentence(sampleText) ||
    `Students can explain the main idea from ${title}.`;
  const skillKey = cleanText(body.skill_key, "resource_reasoning");
  const jobRows = await supabaseFetch(config, "curriculum_import_jobs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: resource.organization_id || null,
      class_id: resource.class_id || null,
      resource_id: resourceId,
      source_type: "resource",
      status: "draft",
      title: `Draft from ${title}`,
      created_by: user.id,
      source_metadata: {
        resource_title: title,
        approved_chunk_count: chunks.length,
        method: "deterministic_v1",
      },
    }),
  }) as DbRow[];
  const job = Array.isArray(jobRows) ? jobRows[0] : null;
  if (!job) throw new Error("Could not create curriculum import job.");

  const suggestions = [
    {
      suggestion_type: "lesson",
      title: `Discuss: ${title}`,
      position: 1,
      payload: {
        lesson: {
          title: `Discuss: ${title}`,
          type: "discussion",
          level: cleanText(body.level, "Any level"),
          tutor_prompt:
            "Guide the student through the teacher-approved resource one idea at a time. Ask for reasoning and examples before assessment.",
          student_prompt: `Let's discuss ${title}.`,
        },
      },
    },
    {
      suggestion_type: "milestone",
      title: `Understand ${title}`,
      position: 2,
      payload: {
        milestone: {
          title: `Understand ${title}`,
          objective,
          skill_keys: [skillKey],
          allowed_response_modes: ["text", "multiple_choice"],
          pass_rule: { min_score: 0.7, teacher_review_allowed: true },
        },
        evidence_source_chunks: chunks.slice(0, 5).map((chunk) => ({
          id: chunk.id,
          page_number: chunk.page_number || null,
          start_seconds: chunk.start_seconds || null,
          end_seconds: chunk.end_seconds || null,
        })),
      },
    },
    {
      suggestion_type: "activity",
      title: "Explain the idea in your own words",
      position: 3,
      payload: {
        activity: {
          stage: "practice",
          response_mode: "text",
          prompt:
            "In your own words, explain the clearest idea from this resource and give one example.",
          rubric: {
            pass: "Student gives a relevant explanation and example tied to the approved resource.",
            skill_keys: [skillKey],
          },
        },
      },
    },
    {
      suggestion_type: "quiz",
      title: "Resource check",
      position: 4,
      payload: {
        quiz: {
          prompt: `Which answer best matches the resource "${title}"?`,
          choices: [
            { id: "a", text: objective || "A clear idea from the resource." },
            { id: "b", text: "A detail that is unrelated to the resource." },
            { id: "c", text: "A claim that should be checked by the teacher." },
          ],
          correct_choice_ids: ["a"],
          review_required: true,
        },
      },
    },
  ];

  const inserted = await supabaseFetch(config, "curriculum_import_suggestions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(
      suggestions.map((suggestion) => ({
        job_id: job.id,
        status: "draft",
        ...suggestion,
      })),
    ),
  });

  return {
    status: "ok",
    job,
    suggestions: inserted,
  };
}


async function listCurriculumImportJob(config: Config, body: DbRow) {
  const jobId = cleanId(body.job_id);
  if (!jobId) throw new Error("job_id is required.");
  const jobs = await supabaseFetch(
    config,
    `curriculum_import_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`,
  ) as DbRow[];
  if (!Array.isArray(jobs) || !jobs[0]) throw new Error("Curriculum import job not found.");
  const suggestions = await supabaseFetch(
    config,
    `curriculum_import_suggestions?job_id=eq.${encodeURIComponent(jobId)}&select=*&order=position.asc`,
  );
  return { status: "ok", job: jobs[0], suggestions };
}
