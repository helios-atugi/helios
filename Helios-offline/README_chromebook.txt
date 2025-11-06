【Helios オフライン起動（Chromebook）】

1) Chromebookの設定 →「開発者」→「Linux 開発環境」を有効化
2) このZIPを「Linux のファイル」に置いて展開
   $ unzip Helios-offline.zip -d helios-offline
3) 起動
   $ cd helios-offline
   $ chmod +x run-unix.sh
   $ ./run-unix.sh
4) ブラウザで http://localhost:5174 を開く

※初回に「python3 not found」と出たら：
   $ sudo apt update && sudo apt install -y python3
