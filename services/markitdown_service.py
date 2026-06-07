from flask import Flask, request, jsonify
from markitdown import MarkItDown
import os
import tempfile
import requests as http

app = Flask(__name__)
md = MarkItDown()

@app.route('/convert', methods=['POST'])
def convert_file():
    """Convert uploaded file to Markdown"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Securely write to a temporary file preserving extension
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name
    
    try:
        result = md.convert(tmp_path)
        markdown = result.text_content
        os.remove(tmp_path)
        
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

@app.route('/convert-url', methods=['POST'])
def convert_url():
    """Convert URL content to Markdown"""
    data = request.get_json() or {}
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
    
    try:
        # Fetch the URL content
        response = http.get(url, timeout=30)
        response.raise_for_status()
        
        # Determine likely file suffix based on content type or url extension
        suffix = '.html'
        if '.' in url.split('/')[-1]:
            url_ext = os.path.splitext(url.split('/')[-1])[1]
            if len(url_ext) <= 5: # reasonable file extension length
                suffix = url_ext
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name
        
        result = md.convert(tmp_path)
        markdown = result.text_content
        os.remove(tmp_path)
        
        return jsonify({'success': True, 'markdown': markdown})
    except Exception as e:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Service health check"""
    return jsonify({'status': 'ok', 'service': 'markitdown'})

if __name__ == '__main__':
    # Default to port 5005
    port = int(os.environ.get('PORT', 5005))
    app.run(port=port, host='0.0.0.0', debug=True)
