<?php
header('Content-Type: application/json');
$sidDir = 'sid/';
$files = array_values(array_filter(scandir($sidDir), function($file) use ($sidDir) {
    return is_file($sidDir . $file) && strtolower(pathinfo($file, PATHINFO_EXTENSION)) === 'sid';
}));
echo json_encode($files);
?>