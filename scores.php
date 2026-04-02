<?php
// 1. Strict Anti-Caching
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');
header('Content-Type: application/json');

// 2. Database configuration
$host = 'localhost';
$db   = 'exoborn_db';
$user = 'root'; // <--- VERIFY THIS
$pass = '';     // <--- VERIFY THIS
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
    
    // 3. Ensure table exists (BIGINT for scores above 1M)
    $pdo->exec("CREATE TABLE IF NOT EXISTS high_scores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name CHAR(3) NOT NULL,
        score BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");

    // Migrate existing INT column to BIGINT if needed (one-time, checks first)
    $colType = $pdo->query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='$db' AND TABLE_NAME='high_scores' AND COLUMN_NAME='score'")->fetchColumn();
    if ($colType && strtolower($colType) !== 'bigint') {
        $pdo->exec("ALTER TABLE high_scores MODIFY COLUMN score BIGINT NOT NULL");
    }

    // 4. Handle New Submissions
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if ($data && !empty($data['name'])) {
            $name = preg_replace('/[^A-Z0-9!?#]/', '', strtoupper(substr($data['name'], 0, 3)));
            $score = max(0, min(999999999, (int)$data['score'])); // cap at ~1B to prevent abuse
            if (strlen($name) === 3 && $score > 0) {
                $stmt = $pdo->prepare("INSERT INTO high_scores (name, score) VALUES (?, ?)");
                $stmt->execute([$name, $score]);
            }
        }
    }

    // 5. Fetch Top 10
    $stmt = $pdo->query("SELECT name, score FROM high_scores ORDER BY score DESC LIMIT 10");
    $scores = $stmt->fetchAll();

    // 6. Diagnostics: If empty, check why
    if (empty($scores)) {
        $count = $pdo->query("SELECT COUNT(*) FROM high_scores")->fetchColumn();
        // If the table is actually empty in THIS database, seed it.
        if ($count == 0) {
            $pdo->exec("INSERT INTO high_scores (name, score) VALUES ('SAB', 15000), ('RED', 12000), ('RUN', 10000)");
            // Re-fetch after seeding
            $stmt = $pdo->query("SELECT name, score FROM high_scores ORDER BY score DESC LIMIT 10");
            $scores = $stmt->fetchAll();
        }
    }

    echo json_encode($scores);

} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB Error: ' . $e->getMessage()]);
} catch (\Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'System Error: ' . $e->getMessage()]);
}
?>