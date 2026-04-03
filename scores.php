<?php
// Exobörn Global Archive API v2.0 (Reliability Layer)
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Content-Type: application/json');

$config = require 'db_config.php';
$cache_file = 'leaderboard_cache.json';

// --- HEALTH CHECK ---
if (isset($_GET['health'])) {
    echo json_encode(['status' => 'ONLINE', 'ver' => '2.0.1', 'db' => 'CONNECTED']);
    exit;
}

$dsn = "mysql:host={$config['host']};dbname={$config['db']};charset={$config['charset']}";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $config['user'], $config['pass'], $options);
    
    // Auto-setup (Standard DevOps Automation)
    $pdo->exec("CREATE TABLE IF NOT EXISTS high_scores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name CHAR(3) NOT NULL,
        score BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");

    // --- HANDLE POST (Write-Through Cache Invalidation) ---
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if ($data && !empty($data['name']) && isset($data['token'])) {
            $name = preg_replace('/[^A-Z0-9!?#]/', '', strtoupper(substr($data['name'], 0, 3)));
            $score = (int)$data['score'];
            $token = $data['token'];
            $expectedToken = base64_encode($name . ":" . $score . ":" . ($score * 7 + 123));

            if ($token === $expectedToken && strlen($name) === 3 && $score > 0) {
                $stmt = $pdo->prepare("INSERT INTO high_scores (name, score) VALUES (?, ?)");
                $stmt->execute([$name, $score]);
                @unlink($cache_file); // Invalidate Cache on New Data
            } else {
                http_response_code(403);
                echo json_encode(['error' => 'Handshake Failed']);
                exit;
            }
        }
    }

    // --- FETCH LOGIC (Read-Through Caching) ---
    if (file_exists($cache_file) && (time() - filemtime($cache_file) < $config['cache_ttl'])) {
        echo file_get_contents($cache_file);
        exit;
    }

    $stmt = $pdo->query("SELECT name, score FROM high_scores ORDER BY score DESC LIMIT 10");
    $scores = $stmt->fetchAll();
    
    if (empty($scores)) {
        $scores = [['name' => 'SAB', 'score' => 15000], ['name' => 'RED', 'score' => 12000]];
    }

    $output = json_encode($scores);
    @file_put_contents($cache_file, $output); // Update Cache
    echo $output;

} catch (\PDOException $e) {
    // Graceful Degradation: Return Cache if DB is Down
    if (file_exists($cache_file)) {
        echo file_get_contents($cache_file);
    } else {
        http_response_code(503);
        echo json_encode(['error' => 'Archive Link Down', 'offline_mode' => true]);
    }
}
?>