<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// 處理 OPTIONS 請求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$logsFile = 'logs.json';

// 確保 logs.json 存在
if (!file_exists($logsFile)) {
    $initialData = [
        'logs' => [],
        'lastUpdate' => date('c'),
        'totalRecords' => 0,
        'version' => '1.0'
    ];
    file_put_contents($logsFile, json_encode($initialData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // 新增日誌記錄
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['action']) || !isset($input['nodeName'])) {
        http_response_code(400);
        echo json_encode(['error' => '缺少必要參數']);
        exit();
    }
    
    // 讀取現有日誌
    $logsData = json_decode(file_get_contents($logsFile), true);
    
    // 建立新日誌記錄
    $newLog = [
        'id' => uniqid(),
        'timestamp' => date('c'),
        'action' => $input['action'],
        'nodeName' => $input['nodeName'],
        'nodeLocation' => $input['nodeLocation'] ?? '',
        'testType' => $input['testType'] ?? null,
        'target' => $input['target'] ?? null,
        'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'sessionId' => $input['sessionId'] ?? uniqid()
    ];
    
    // 添加到日誌陣列
    $logsData['logs'][] = $newLog;
    $logsData['totalRecords'] = count($logsData['logs']);
    $logsData['lastUpdate'] = date('c');
    
    // 只保留最近 1000 筆記錄
    if (count($logsData['logs']) > 1000) {
        $logsData['logs'] = array_slice($logsData['logs'], -1000);
        $logsData['totalRecords'] = 1000;
    }
    
    // 寫入檔案
    if (file_put_contents($logsFile, json_encode($logsData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
        echo json_encode(['success' => true, 'id' => $newLog['id']]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => '無法寫入日誌檔案']);
    }
    
} elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // 讀取日誌記錄
    $logsData = json_decode(file_get_contents($logsFile), true);
    
    // 可選的查詢參數
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 100;
    $offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;
    
    // 取得指定範圍的日誌
    $logs = array_slice($logsData['logs'], -($limit + $offset), $limit);
    
    echo json_encode([
        'logs' => array_reverse($logs), // 最新的在前
        'totalRecords' => $logsData['totalRecords'],
        'lastUpdate' => $logsData['lastUpdate']
    ]);
    
} else {
    http_response_code(405);
    echo json_encode(['error' => '不支援的請求方法']);
}
?>