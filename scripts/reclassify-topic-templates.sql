-- Reclassify existing templates that start with "Topic Extractor" to be topic-extraction type
UPDATE PromptTemplate 
SET templateType = 'topic-extraction',
    updatedAt = datetime('now')
WHERE name LIKE 'Topic Extractor %' 
   OR name LIKE 'topic-extractor%';