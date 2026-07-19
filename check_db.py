import os
import sys
sys.path.insert(0, 'backend')

try:
    from supabase import create_client
    
    SUPABASE_URL = "https://qiapbljkhbpybhqcshjo.supabase.co"
    SUPABASE_KEY = "***"
    
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Try to query each table
    tables = ['profiles', 'conversations', 'messages']
    
    for table in tables:
        try:
            result = supabase.table(table).select('*').limit(1).execute()
            print(f"✓ {table} table exists")
        except Exception as e:
            print(f"✗ {table} table missing or error: {e}")
            
except ImportError as e:
    print(f"Cannot import supabase: {e}")
except Exception as e:
    print(f"Error: {e}")
