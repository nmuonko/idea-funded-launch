SELECT cron.schedule(
  'promote-popular-searches-weekly',
  '0 0 * * 0',
  $$SELECT public.promote_popular_searches(3, 168, true);$$
);