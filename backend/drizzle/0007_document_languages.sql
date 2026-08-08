UPDATE "documents"
SET "language" = CASE
  WHEN "path" ~ '\\.tsx?$' THEN 'typescript'
  WHEN "path" ~ '\\.jsx?$' THEN 'javascript'
  WHEN "path" ~ '\\.json$' THEN 'json'
  WHEN "path" ~ '\\.md$' THEN 'markdown'
  ELSE "language"
END
WHERE "language" IS NULL;
