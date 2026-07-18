-- Temporary function to execute schema SQL
CREATE OR REPLACE FUNCTION public.exec_schema_sql(sql_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_text;
  RETURN 'Schema executed successfully';
END;
$$;
