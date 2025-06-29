// Cloudflare Worker for Looking Glass Logs
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 設定 CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // 處理 OPTIONS 請求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 除錯端點 - 檢查 KV 綁定
      if (request.method === 'GET' && url.pathname === '/api/debug') {
        return new Response(
          JSON.stringify({
            message: 'Worker is running',
            env_keys: Object.keys(env),
            has_LOGS: env.LOGS !== undefined,
            timestamp: new Date().toISOString()
          }),
          { headers: corsHeaders }
        );
      }
      
      if (request.method === 'POST' && url.pathname === '/api/logs') {
        // 新增日誌
        const body = await request.json();
        
        // 驗證必要欄位
        if (!body.action || !body.nodeName) {
          return new Response(
            JSON.stringify({ error: '缺少必要參數' }), 
            { status: 400, headers: corsHeaders }
          );
        }

        // 獲取真實 IP
        const ip = request.headers.get('CF-Connecting-IP') || 
                   request.headers.get('X-Forwarded-For') || 
                   'unknown';

        // 建立日誌記錄
        const logEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          action: body.action,
          nodeName: body.nodeName,
          nodeLocation: body.nodeLocation || '',
          testType: body.testType || null,
          target: body.target || null,
          ip: ip,
          userAgent: request.headers.get('User-Agent') || '',
          sessionId: body.sessionId || crypto.randomUUID(),
          country: request.cf?.country || 'unknown',
          city: request.cf?.city || 'unknown'
        };

        // 檢查 KV 是否綁定
        if (!env.LOGS) {
          return new Response(
            JSON.stringify({ 
              error: 'KV namespace LOGS is not bound. Please check your Worker settings.',
              instructions: '請在 Worker Settings → Bindings 中綁定 KV namespace，Variable name 必須是 LOGS'
            }), 
            { status: 500, headers: corsHeaders }
          );
        }
        
        // 從 KV 讀取現有日誌
        let logsData = await env.LOGS.get('logs', 'json') || { 
          logs: [], 
          totalRecords: 0,
          lastUpdate: new Date().toISOString()
        };
        
        // 添加新日誌
        logsData.logs.unshift(logEntry);
        logsData.totalRecords = logsData.logs.length;
        logsData.lastUpdate = new Date().toISOString();
        
        // 只保留最近 1000 筆
        if (logsData.logs.length > 1000) {
          logsData.logs = logsData.logs.slice(0, 1000);
          logsData.totalRecords = 1000;
        }

        // 儲存到 KV
        await env.LOGS.put('logs', JSON.stringify(logsData));

        console.log(`新日誌記錄: ${body.action} - ${body.nodeName} from ${ip}`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            id: logEntry.id,
            totalRecords: logsData.totalRecords,
            message: '日誌已成功記錄'
          }),
          { headers: corsHeaders }
        );

      } else if (request.method === 'GET' && url.pathname === '/api/logs') {
        // 檢查 KV 是否綁定
        if (!env.LOGS) {
          return new Response(
            JSON.stringify({ 
              error: 'KV namespace LOGS is not bound',
              solution: 'Please bind KV namespace in Worker Settings → Bindings',
              variable_name: 'LOGS'
            }), 
            { status: 500, headers: corsHeaders }
          );
        }
        
        // 讀取日誌
        const limit = parseInt(url.searchParams.get('limit') || '200');
        const logsData = await env.LOGS.get('logs', 'json') || { 
          logs: [], 
          totalRecords: 0,
          lastUpdate: null 
        };
        
        return new Response(
          JSON.stringify({
            logs: logsData.logs.slice(0, limit),
            totalRecords: logsData.totalRecords,
            lastUpdate: logsData.lastUpdate
          }),
          { headers: corsHeaders }
        );

      } else if (request.method === 'GET' && url.pathname === '/api/stats') {
        // 獲取統計資料
        const logsData = await env.LOGS.get('logs', 'json') || { logs: [] };
        
        const stats = {
          totalLogs: logsData.logs.length,
          uniqueIPs: new Set(logsData.logs.map(log => log.ip)).size,
          nodeUsage: {},
          testTypes: {},
          countries: {}
        };
        
        logsData.logs.forEach(log => {
          // 節點使用統計
          if (!stats.nodeUsage[log.nodeName]) {
            stats.nodeUsage[log.nodeName] = 0;
          }
          stats.nodeUsage[log.nodeName]++;
          
          // 測試類型統計
          if (log.testType) {
            if (!stats.testTypes[log.testType]) {
              stats.testTypes[log.testType] = 0;
            }
            stats.testTypes[log.testType]++;
          }
          
          // 國家統計
          if (log.country && log.country !== 'unknown') {
            if (!stats.countries[log.country]) {
              stats.countries[log.country] = 0;
            }
            stats.countries[log.country]++;
          }
        });
        
        return new Response(
          JSON.stringify(stats),
          { headers: corsHeaders }
        );

      } else {
        return new Response(
          JSON.stringify({ error: 'Not found' }), 
          { status: 404, headers: corsHeaders }
        );
      }

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ error: error.message }), 
        { status: 500, headers: corsHeaders }
      );
    }
  }
};