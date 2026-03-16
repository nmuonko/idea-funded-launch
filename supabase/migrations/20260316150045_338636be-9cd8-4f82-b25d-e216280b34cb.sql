-- Pause non-SHEIN Firecrawl scrapers by setting daily budget to 0
UPDATE provider_budget SET limit_count = 0, updated_at = now() WHERE provider = 'firecrawl:cargurus' AND window_type = 'day';
UPDATE provider_budget SET limit_count = 0, updated_at = now() WHERE provider = 'firecrawl:carvana' AND window_type = 'day';
UPDATE provider_budget SET limit_count = 0, updated_at = now() WHERE provider = 'amazon' AND window_type = 'hour';