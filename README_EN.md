# Looking Glass - Network Monitoring Tool

**English | [中文](README.md)**

An open-source network monitoring project maintained by a group of BGP Players, providing global network node connectivity testing services to help users understand their network connection status.

## 🌟 Features

- 🌍 **Global Node Coverage** - Multiple regional network node testing points
- 🔍 **Multiple Testing Tools**
  - Ping Test - Check latency and packet loss
  - Traceroute - View network path routing
  - MTR Analysis - Advanced tool combining Ping and Traceroute
- 📊 **Real-time Test Results** - Quick and accurate network diagnostics
- 📱 **Responsive Design** - Support for desktop and mobile devices
- 📈 **Statistics Analysis** - Node status monitoring and usage analytics
- 📝 **Usage Logs** - Test history tracking and popular targets

## 🛠 Technical Stack

- **Frontend Framework**: Bootstrap 5 + Vanilla JavaScript
- **API Integration**: Globalping.io global testing network
- **Monitoring Tool**: Smokeping network quality monitoring
- **Data Storage**: localStorage + JSON + Cloudflare Worker
- **Version Control**: GitHub

## 🚀 Quick Start

### Online Usage
Visit any of the following URLs:
- [https://lg.yuan-tw.net](https://lg.yuan-tw.net)
- [https://lg.zhuyuan.tw](https://lg.zhuyuan.tw)
- [https://lg.c-h.tw](https://lg.c-h.tw)

### Local Deployment
```bash
# Clone the repository
git clone https://github.com/tw-yuan/looking-glass-new.git

# Enter project directory
cd looking-glass-new

# Start with any HTTP server
python3 -m http.server 8000
# Or use Node.js
npx serve .
```

Then open your browser and visit `http://localhost:8000`

## 📋 Node List

Currently supported testing nodes include:
- 🇹🇼 Taiwan (Tainan, New Taipei, Taipei)
- 🇭🇰 Hong Kong
- 🇯🇵 Japan (Tokyo)
- 🇸🇬 Singapore
- 🇺🇸 United States (Multiple cities)
- 🇪🇺 Europe (Multiple countries)

## 🤝 Contributing

### Adding New Nodes
To add new testing nodes, please submit a Pull Request:

1. Fork this project
2. Add node information in `nodes.json`:
```json
{
  "name": "Node Name",
  "name_zh": "Chinese Name", 
  "location": "City",
  "location_zh": "Chinese City",
  "provider": "Provider",
  "provider-link": "https://provider.com",
  "tags": "provider-tag:node-id",
  "networkType": "Academic/Commercial/CDN",
  "asn": 12345,
  "continent": "asia/europe/america/oceania/africa"
}
```
3. Submit a Pull Request

### Reporting Issues
If you find bugs or have feature suggestions, please report them in [Issues](https://github.com/tw-yuan/looking-glass-new/issues).

## 📊 API Limitations

This project uses the Globalping.io API with the following limitations:
- **Unregistered Users**: 250 tests per hour
- **Registered Users**: 500 tests per hour

When limits are reached, the system will display warning messages and show remaining reset time.

## 🔗 Related Links

- [Smokeping Monitoring](https://smokeping.zhuyuan.tw) - Long-term network quality monitoring
- [IP Information Query](https://tools.cre0809.com/myip/) - Check your IP information
- [NCSE Network](https://ncse.tw) - Network service provider

## 📞 Contact Us

- **Email**: [me@yuan-tw.net](mailto:me@yuan-tw.net)
- **GitHub**: [tw-yuan/looking-glass-new](https://github.com/tw-yuan/looking-glass-new)
- **Issue Reports**: [GitHub Issues](https://github.com/tw-yuan/looking-glass-new/issues)

## 👥 Contributors

### Maintainers
- **[Zhuyuan](https://zhuyuan.tw/)**
- **[CH](https://thisisch.net/)**
- **[Yuan](https://yuan-tw.net/)**

### Special Thanks
- **[STUIX](https://stuix.io/)**
- **[CoCoDigit](https://www.cocodigit.com/)**
- **[NCSE Network](https://ncse.tw)**
- **[cute_panda](https://github.com/asdf3601a)**
- **[Ricky](https://www.simple.taipei)**
- **[Cheese_ge](https://cheesege.github.io/)**
- **[Qian](https://blog.qian30.net/)**

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Thanks to [Globalping.io](https://globalping.io) for providing free global network testing API, making this project possible.

---

**© 2025 Looking Glass @yuan-tw.net, @zhuyuan.tw, @c-h.tw**