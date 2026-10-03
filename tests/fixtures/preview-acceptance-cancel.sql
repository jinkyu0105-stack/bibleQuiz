-- Safe cancellation for the synthetic P4-23 Preview acceptance candidate.
-- The quiz is removed only if it has never received a submission. This preserves
-- participation and audit evidence instead of cascading through operational data.
PRAGMA foreign_keys = ON;

DELETE FROM quiz_sets
WHERE id = 'p423-preview-set'
  AND NOT EXISTS (
    SELECT 1 FROM submissions
    WHERE quiz_variant_id = 'p423-preview-child'
  );

DELETE FROM sermons
WHERE id = 'p423-preview-sermon'
  AND NOT EXISTS (
    SELECT 1 FROM quiz_sets
    WHERE sermon_id = 'p423-preview-sermon'
  );

DELETE FROM bible_translations
WHERE id = 'p423-preview-translation'
  AND NOT EXISTS (
    SELECT 1 FROM sermons
    WHERE bible_translation_id = 'p423-preview-translation'
  );
