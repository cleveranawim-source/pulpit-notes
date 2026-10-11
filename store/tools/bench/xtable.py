# xctrace export 표(XML)를 행 목록으로: id/ref 압축을 풀어 (열이름 → 값, 표시문자) 로 돌려준다
import sys, xml.etree.ElementTree as ET
def rows(path):
    root = ET.parse(path).getroot()
    node = root.find('node')
    if node is None: return [], []
    cols = [c.findtext('mnemonic') for c in node.find('schema').findall('col')]
    ids = {}
    def val(e):
        if 'ref' in e.attrib: return ids[e.attrib['ref']]
        v = (e.text, e.attrib.get('fmt'))
        if 'id' in e.attrib: ids[e.attrib['id']] = v
        for ch in e:  # 안쪽 요소도 id 를 등록해 둔다
            val(ch)
        return v
    out = []
    for r in node.findall('row'):
        vals = [val(e) for e in r]
        out.append(dict(zip(cols, vals)))
    return cols, out
if __name__ == '__main__':
    cols, rs = rows(sys.argv[1]); print(cols, len(rs))
    for r in rs[:int(sys.argv[2]) if len(sys.argv) > 2 else 5]: print(r)
